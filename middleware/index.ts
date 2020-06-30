import {Logger, LoggerLevel} from '@salesforce/core/lib/logger';
import {SObject} from '@salesforce/salesforce-sdk/dist/objects';
import {Constants, APIVersion} from '@salesforce/salesforce-sdk/dist/index';
import {
    ConnectionConfig,
    DataApi,
    ErrorResult,
    Secrets,
    SuccessResult,
    UnitOfWork,
    UnitOfWorkGraph,
} from '@salesforce/salesforce-sdk/dist/api';

import {
    Context,
    InvocationEvent,
    Org,
    User,
} from '@salesforce/salesforce-sdk/dist/functions';
const {Message} = require('@projectriff/message');

import loadUserFunction from './userFnLoader'

const ASYNC_HEADER = 'X-Async-Fulfill-Request'

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
    let unitOfWorkGraph: UnitOfWorkGraph | undefined;
    if (accessToken) {
        const config: ConnectionConfig = new ConnectionConfig(
            accessToken,
            apiVersion,
            userContext.salesforceBaseUrl
        );
        unitOfWork = new UnitOfWork(config, logger);
        if (apiVersion >= APIVersion.V50) {
            unitOfWorkGraph = new UnitOfWorkGraph(config, logger);
        }
        dataApi = new DataApi(config, logger);
    }

    return new Org(
        apiVersion,
        userContext.salesforceBaseUrl,
        userContext.orgDomainUrl,
        userContext.orgId,
        user,
        dataApi,
        unitOfWork,
        unitOfWorkGraph
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
 * @param request     -- contains {payload, headers}
 * @param logger      -- Logger
 * @return returnArgs -- array of arguments that make-up the user functions arguments
 */
function applySfFxMiddleware(request: any, logger: Logger): Array<any> {
    // Validate the input request
    if (!request) {
        throw new Error('Request Data not provided');
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

    // Construct invocation context, to be sent to the user function.
    const context = createContext(request.payload.id,
                                  logger,
                                  secrets,
                                  data.context,
                                  accessToken,
                                  functionInvocationId);

    // Function params
    return [event, context, logger];
}

function createLogger(requestID?: string): Logger {
    const logger = new Logger('Evergreen Logger');
    const level = process.env.DEBUG ? LoggerLevel.DEBUG : LoggerLevel.INFO;

    logger.addStream({stream: process.stderr});
    logger.setLevel(level);

    if (requestID) {
        logger.addField('request_id', requestID);
    }

    return logger;
}

function errorMessage(error: Error): any {
    // any error in user-function-space should be considered a 500
    // ensure we send down application/json in this case
    return Message.builder()
        .addHeader('content-type', 'application/json')
        .addHeader('x-http-status', '500')
        .payload({
            error: error.toString(),
        })
        .build();
}

function isInitialAsyncRequest(payload: any, headers: any): boolean {
    return payload.type 
        && payload.type.startsWith('com.salesforce.function.async')
        && !headers[ASYNC_HEADER];
}

// Invoke given function again to fulfill async request; response is not handled
async function invokeAsyncFn(logger: Logger, payload: any, headers: any): Promise<void> {
    let hostUrl = headers['Host'] || payload?.data?.sfContext?.resource;
    if (!hostUrl) {
        throw new Error('Unable to determine host');
    }

    headers[ASYNC_HEADER] = 'true';
    const parsedUrl = require('url').parse(hostUrl);
    const https = parsedUrl.protocol.startsWith('https');

    const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (https ? 443 : 80),
        method: 'POST',
        path: '/',
        headers
    };

    // Invoke function and ignore response
    const lib = require(https ? 'https' : 'http');
    await new Promise((resolve, reject) => {
        const req = lib.request(options);
        req.on('error', (err) => {
            // Expect ECONNRESET when request was destroyed
            if (!(req.destroyed && err.code === 'ECONNRESET')) {
                reject(err);
            }
        });

        // Forward original request
        req.write(JSON.stringify(payload));
        
        // Flush and finishes sending the request
        req.end(() => {
            logger.info('### Forwarded async request');

            // Forget response and destroy the socket
            req.destroy();

            // Don't care about response
            resolve();
        });
    });
};

const userFn = loadUserFunction();

export default async function systemFn(message: any): Promise<any> {
    const payload = message['payload'];

    // Remap riff headers to a standard JS object
    const headers = message['headers'].toRiffHeaders();
    Object.keys(headers).map((key: string) => {headers[key] = message['headers'].getValue(key)});

    const requestId = headers['Ce-Id'] || headers['X-Request-Id'];
    const requestLogger = createLogger(requestId);
    try {
        // If initial async request, invoke function again and release request
        if (isInitialAsyncRequest(payload, headers)) {
            requestLogger.info('### Received initial async request');
            await invokeAsyncFn(requestLogger, payload, headers);
            requestLogger.info('### Return initial async request');
            // TODO: How to send 202?
            return '';
        }

        const middlewareResult = await applySfFxMiddleware({payload, headers}, requestLogger);
        const result = await userFn(...middlewareResult);

        // Currently, riff doesn't support undefined or null return values
        return result || '';
    } catch (error) {
        requestLogger.error(error.toString());
        return errorMessage(error)
    }
}

systemFn.$argumentType = 'message';
systemFn.$init = userFn.$init;
systemFn.$destroy = userFn.$destroy;
