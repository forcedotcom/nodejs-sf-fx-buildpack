/* eslint-disable @typescript-eslint/no-explicit-any */
import {Logger, LoggerLevel} from '@salesforce/core/lib/logger';
import {Constants, APIVersion} from '@salesforce/salesforce-sdk/dist/index';
import {
    ConnectionConfig,
    DataApi,
    Secrets,
    UnitOfWork,
    UnitOfWorkGraph,
} from '@salesforce/salesforce-sdk/dist/api';
import {
    Context,
    InvocationEvent,
    Org,
    User,
} from '@salesforce/salesforce-sdk/dist/functions';
import { FunctionInvocationRequest } from './FunctionInvocationRequest';
import {FN_INVOCATION} from './constants';

function headersToMap(headers: any = {}): ReadonlyMap<string, ReadonlyArray<string>> {
    const headersMap: Map<string, ReadonlyArray<string>> = new Map(Object.entries(headers));
    return headersMap;
}

/**
 * Construct Event from invocation request.
 *
 * @param isSpec02  -- true if request was given as an older CloudEvent 0.2 spec
 * @param fnPayload    -- function payload
 * @param headers -- request headers
 * @param ceBody -- request payload (Cloudevent)
 * @return event
 */
function createEvent(isSpec02: boolean, fnPayload: any, headers: any, ceBody: any): InvocationEvent {
    const schemaURL = isSpec02 ? ceBody.schemaURL : null;
    let contentType;
    if (isSpec02) {
        contentType = ceBody.contentType ? ceBody.contentType : ceBody.contenttype;
    }
    else {
        contentType = ceBody.datacontenttype;
    }
    return new InvocationEvent(
        fnPayload,
        contentType,
        schemaURL,
        ceBody.id,
        ceBody.source,
        ceBody.time,
        ceBody.type,
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
    let fnInvocation: FunctionInvocationRequest;
    if (accessToken && functionInvocationId) {
        fnInvocation = new FunctionInvocationRequest(functionInvocationId, logger, org.data);
        context[FN_INVOCATION] = fnInvocation;
    }
    return context;
}

/**
 * Decode a "context" CloudEvent attribute that has been encoded to be compliant with the 1.0
 * specification - will arrive as a Base64-encoded-JSON string.
 * @param attrVal CloudEvent attribute value to decode.
 * @returns null on empty attrVal, decoded JS Object if successful.
 */
function decodeCeAttrib(attrVal: string|undefined): any {
    if (attrVal != null) {
        const buf = Buffer.from(attrVal, 'base64');
        return JSON.parse(buf.toString());
    }
    return null;
}

/**
* Initialize Salesforce SDK for function invocation.
*
* @param request     -- contains {payload, headers}
* @param logger      -- Logger
* @return returnArgs -- array of arguments that make-up the user functions arguments
*/
export function applySfFnMiddleware(request: any, logger: Logger): Array<any> {
    // Validate the input request
    if (!request) {
        throw new Error('Request Data not provided');
    }

    //use secret here in lieu of DEBUG runtime environment var until we have deployment time support of config var
    const secrets = createSecrets(logger);
    const debugSecret = secrets.getValue('sf-debug', 'DEBUG');
    logger.info(`DEBUG flag is ${debugSecret ? debugSecret : 'unset'}`);
    if (debugSecret || LoggerLevel.DEBUG === logger.getLevel() || process.env.DEBUG) {
        //for dev preview, we log the ENTIRE raw request, may need to filter sensitive properties out later
        //the hard part of filtering is to know which property name to filter
        //change the logger level, so any subsequent user function's logger.debug would log as well
        logger.setLevel(LoggerLevel.DEBUG);
        logger.debug('debug raw request in middleware');
        logger.debug(request);
    }

    // Pull the relevant fields out of the CloudEvent body, depending on the Spec version
    const ceBody = request.payload;
    const specVersion = ceBody.specversion ? ceBody.specversion : ceBody.specVersion;
    const isSpec02 = specVersion === '0.2';
    const data = ceBody.data;
    if (!data) {
        throw new Error('Data field of the cloudEvent not provided in the request');
    }
    const ceCtx = isSpec02 ? data.context : decodeCeAttrib(ceBody.sfcontext);
    const ceFnCtx = isSpec02 ? data.sfContext : decodeCeAttrib(ceBody.sffncontext);
    if (!ceCtx) {
        logger.warn('Context not provided in data: context is partially initialize');
    }

    // Customer payload is data.payload for old spec version, data for 1.0+
    const fnPayload = isSpec02 ? data.payload : data;

    // Not all functions will require an accessToken used for org access.
    // The accessToken will not be passed directly to functions, but instead
    // passed as part of function context used in SF middleware to setup API instances.
    let accessToken: string;
    let functionInvocationId: string;
    if (ceFnCtx) {
        accessToken = ceFnCtx.accessToken || undefined;
        functionInvocationId = ceFnCtx.functionInvocationId || undefined;
        // Internal only, will be noop for specversion 1.0+
        delete data.sfContext;
    }

    // Construct event contain custom payload and details about the function request
    const event = createEvent(isSpec02, fnPayload, request.headers, ceBody);

    // Construct invocation context, to be sent to the user function.
    const context = createContext(ceBody.id,
        logger,
        secrets,
        ceCtx,
        accessToken,
        functionInvocationId);

    // Function params
    return [event, context, logger];
}
