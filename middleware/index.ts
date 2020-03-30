import * as fs from 'fs';
import {LoggerLevel} from '@salesforce/core';
import {
    ConnectionConfig,
    Constants,
    Context,
    DataApi,
    ErrorResult,
    InvocationEvent,
    Logger,
    Org,
    Secrets,
    SObject,
    SuccessResult,
    UnitOfWork,
    User,
} from '@salesforce/salesforce-sdk';

// TODO: Remove when FunctionInvocationRequest is deprecated.
class FunctionInvocationRequest {
  public response: any;
  public status: string;

  constructor(public readonly id: string,
              private readonly logger: Logger,
              private readonly dataApi?: DataApi) {
  }

  /**
   * Saves FunctionInvocationRequest
   *
   * @throws err if response not provided or on failed save
   */
  public async save(): Promise<any> {
      if (!this.response) {
          throw new Error('Response not provided');
      }

      if (this.dataApi) {
          const responseBase64 = Buffer.from(JSON.stringify(this.response)).toString('base64');

          try {
              // Prime pump (W-6841389)
              const soql = `SELECT Id, FunctionName, Status, CreatedById, CreatedDate FROM FunctionInvocationRequest WHERE Id ='${this.id}'`;
              await this.dataApi.query(soql);
          } catch (err) {
              this.logger.warn(err.message);
          }

          const fxInvocation = new SObject('FunctionInvocationRequest').withId(this.id);
          fxInvocation.setValue('ResponseBody', responseBase64);
          const result: SuccessResult | ErrorResult = await this.dataApi.update(fxInvocation);
          if (!result.success && 'errors' in result) {
              // Tells tsc that 'errors' exist and join below is okay
              const msg = `Failed to send response [${this.id}]: ${result.errors.join(',')}`;
              this.logger.error(msg);
              throw new Error(msg);
          } else {
              return result;
          }
      } else {
          throw new Error('Authorization not provided');
      }
  }
}

function headersToMap(headers: any = {}): ReadonlyMap<string, ReadonlyArray<string>> {
    const headersMap: Map<string, ReadonlyArray<string>> = new Map(Object.entries(headers));
    return headersMap;
}

/**
 * Construct Event from invocation request.
 *
 * @param data    -- function payload
 * @param headers -- request headers
 * @param payload -- request payload
 * @return event
 */
function createEvent(data: any, headers: any, payload: any): InvocationEvent {
    return new InvocationEvent(
        data,
        payload.contentType,
        payload.schemaURL,
        payload.id,
        payload.source,
        payload.time,
        payload.type,
        headersToMap(headers)
    );
}

/**
 * Construct User object from the request context.
 *
 * @param userContext -- userContext object representing invoking org and user
 * @return user
 */
function createUser(userContext: any): User {
    return new User(
        userContext.userId,
        userContext.username,
        userContext.onBehalfOfUserId
    );
}

/**
 * Construct Secrets object with logger.
 *
 *
 * @param logger -- logger to use in case of secret load errors
 * @return secrets loader/cache
 */
function createSecrets(logger: Logger): Secrets {
    return new Secrets(logger);
}

/**
 * Construct Org object from the request context.
 *
 * @param reqContext
 * @return org
 */
function createOrg(logger: Logger, reqContext: any, accessToken?: string): Org {
    const userContext = reqContext.userContext;
    if (!userContext) {
        const message = `UserContext not provided: ${JSON.stringify(reqContext)}`;
        throw new Error(message);
    }

    const apiVersion = reqContext.apiVersion || process.env.FX_API_VERSION || Constants.CURRENT_API_VERSION;
    const user = createUser(userContext);

    // If accessToken was provided, setup APIs.
    let dataApi: DataApi | undefined;
    let unitOfWork: UnitOfWork | undefined;
    if (accessToken) {
        const config: ConnectionConfig = new ConnectionConfig(
            accessToken,
            apiVersion,
            userContext.salesforceBaseUrl
        );
        unitOfWork = new UnitOfWork(config, logger);
        dataApi = new DataApi(config, logger);
    }

    return new Org(
        apiVersion,
        userContext.salesforceBaseUrl,
        userContext.orgDomainUrl,
        userContext.orgId,
        user,
        dataApi,
        unitOfWork
    );
}

/**
 * Construct Context from function payload.
 *
 * @param id                   -- request payload id
 * @param logger               -- logger
 * @param secrets              -- secrets convenience class
 * @param reqContext           -- reqContext from the request, contains salesforce stuff (user reqContext, etc)
 * @param accessToken          -- accessToken for function org access, if provided
 * @param functionInvocationId -- FunctionInvocationRequest ID, if applicable
 * @return context
 */
function createContext(id: string, logger: Logger, secrets: Secrets, reqContext?: any,
                       accessToken?: string, functionInvocationId?: string): Context {
    if (typeof reqContext === 'string') {
        reqContext = JSON.parse(reqContext);
    }

    const org = reqContext ? createOrg(logger, reqContext!, accessToken) : undefined;
    const context = new Context(id, logger, org, secrets);

    // If functionInvocationId is provided, create and set FunctionInvocationRequest object
    let fxInvocation: FunctionInvocationRequest;
    if (accessToken && functionInvocationId) {
        fxInvocation = new FunctionInvocationRequest(functionInvocationId, logger, org.data);
        context['fxInvocation'] = fxInvocation;
    }
    return context;
}

/**
 * Initialize Salesforce SDK for function invocation.
 *
 * @param request     -- contains {payload,headers}, see https://github.com/heroku/node-function-buildpack/blob/master/system/index.js#L59
 * @param state       -- not used as an input here
 * @param resultArgs  -- Array, the last element is logger, from the node-function-buildpack's system function
 * @return returnArgs -- array of arguments that will be passed to the next middleware function chain as the resultArgs(the 3rd argument)
 *                  OR
 *                  as the input argument to user functions if this is the last middleware function
 */
export default function applySfFxMiddleware(request: any, state: any, resultArgs: Array<any>): Array<any> {
    // Validate the input request
    if (!request) {
        throw new Error('Request Data not provided');
    }

    // Logger is the last element in the array
    const logger: Logger = resultArgs[resultArgs.length-1];
    if (!logger) {
        throw new Error('Logger not provided in resultArgs from node system function');
    }

    //use secret here in lieu of DEBUG runtime environment var until we have deployment time support of config var
    const secrets = createSecrets(logger);
    const debugSecret = secrets.getValue("sf-debug", "DEBUG");
    logger.info(`DEBUG flag is ${debugSecret ? debugSecret : 'unset'}`);
    if(debugSecret || LoggerLevel.DEBUG === logger.getLevel() || process.env.DEBUG) {
        //for dev preview, we log the ENTIRE raw request, may need to filter sensitive properties out later
        //the hard part of filtering is to know which property name to filter
        //change the logger level, so any subsequent user function's logger.debug would log as well
        logger.setLevel(LoggerLevel.DEBUG);
        logger.debug('debug raw request in middleware');
        logger.debug(request);
    }

    const data = request.payload.data;
    if (!data) {
        throw new Error('Data field of the cloudEvent not provided in the request');
    }

    if (!data.context) {
        logger.warn('Context not provided in data: context is partially initialize');
    }

    // Not all functions will require an accessToken used for org access.
    // The accessToken will not be passed directly to functions, but instead
    // passed as part of SFContext used in SF middleware to setup API instances.
    let accessToken: string;
    let functionInvocationId: string;
    if (data.sfContext) {
        accessToken = data.sfContext.accessToken || undefined;
        functionInvocationId = data.sfContext.functionInvocationId || undefined;
        // Internal only
        delete data.sfContext;
    }

    // Construct event contain custom payload and details about the function request
    const event = createEvent(data.payload, request.headers, request.payload);

    // Construct invocation context, send it to the user function.
    // The logger has been init'ed in the system function of the node
    // function buildpack, is passed in as an attribute on the resultArgs
    const context = createContext(request.payload.id,
                                  logger,
                                  secrets,
                                  data.context,
                                  accessToken,
                                  functionInvocationId);

    // Function params
    return [event, context, logger];
}
