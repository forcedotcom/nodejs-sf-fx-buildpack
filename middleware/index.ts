
import { ConnectionConfig, 
        Constants, 
        ForceApi, 
        Logger, 
        UnitOfWork, 
        FunctionInvocationRequest, 
        UserContext as SdkUseContext,
        Context as SdkContext } from '@heroku/salesforce-sdk';

/**
 * sample request body from core
 * 
{
  "type": "com.salesforce.function.invoke",
  "source": "urn:event:from:salesforce/xx/224.0/00Dxx0000006KYV/PrintJob/9mdxx00000002Hx",
  "id": "00Dxx0000006KYV-4SRXEGsFmeIAEV2VI5V21V",
  "time": "2019-11-14T20:45:33.588066Z",
  "schemaURL": null,
  "contentType": "application/json",
  "data": {
    "context": {
      "apiVersion": "48.0",
      "payloadVersion": "224.1",
      "userContext": {
        "orgId": "00Dxx0000006KYV",
        "userId": "005xx000001X9sT",
        "onBehalfOfUserId": null,
        "username": "cloud@00dxx0000006kyvea2",
        "salesforceBaseUrl": "http://jqian-ltm.internal.salesforce.com:6109",
        "orgDomainUrl": null
      }
    },
    "payload": {
      "jobId": "PDF-JOB-2c33a77f-36c3-4c8a-aa9e-9a2925487349",
      "url": "http://c.dev.visual.localhost.soma.force.com:6109/apex/advancedVPage?__pdffx-renderas-override__=true",
      "html": null,
      "isLightning": false,
      "sessionId": "00Dxx0000006KYV!AQEAQFs8bC0sxQ_B.Qpt1c_GPLLEsQi9WGbCEUJlSJ8.MGC_Bzr1YQLu6m8vpW0VfEixurFuG8AhdYWpqSwdHrnhwLgT0681",
      "lightningSessionId": null,
      "requestVerificationToken": "AAAAAW5rqoZdAAAAAAAAAAAAAAAAAAAAAAAA4HheNFAbDl8vpenXOXb8kopR4X3uTxj9yZrtpnrW6j0RQzBQh6lr42mq_0OOuGMxDJgZPfJNLARHSAfkNWsZaFs="
    },
    "sfContext": {
      "accessToken": "00Dxx0000006KYV!AQEAQHgHXd4DkZjmed1wSZMh85jXq8nAzAIt1zeK.NrvrHaSoemaPjbIDwfTWxdDrlu3Mpuft5JchelVkJ3mkwW_GKz2eOK.",
      "functionInvocationId": "9mdxx00000002Hx",
      "functionName": "salesforce/lightning-bridge/pdf-creator",
      "requestId": "4SRXEGsFmeIAEV2VI5V21V",
      "resource": null
    }
  },
  "specVersion": "0.2"
}
 */

/**
 * @param request -- contains [headers, payload] 
 * @param state -- not used as an input here
 * @param resultArgs -- not used as an input here
 */
export default function applySfFxMiddleware(request: any, state: any, resultArgs: any): any {
    debugger;
    console.log("Starting salesforce functions middleware");

    //validate the input request
    if (!request) {
        throw new Error('Request Data not provided');
    }

    const data = request.payload.data;
    if (!data) {
        throw new Error('Data not provided');
    }

    // Again, this is temp: context param will be fully setup sdk.Context instance.
    const reqContext = data.context;
    if (!reqContext) {
        throw new Error('Context not provided in data');
    }

    const userFxPayload = data.payload;

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

    //construct the sdk context, send it to the user function
    const sdkContext = createSdkContext(reqContext,                                         
                                        accessToken, 
                                        functionInvocationId);
    return [userFxPayload, sdkContext];
}

/**
 * construct sdk Context using the following input params
 * 
 * @param reqContext - reqContext from the request, contains salesforce stuff (user reqContext, etc)
 * @param accessToken 
 * @param functionInvocationId 
 */
function createSdkContext(reqContext: any, accessToken?: string, functionInvocationId?: string): SdkContext {
    if (!reqContext) {
        throw new Error('Context not provided.');
    }

    if (typeof reqContext === 'string') {
        reqContext = JSON.parse(reqContext);
    }

    const userCtx = createSdkUserContext(reqContext);
    const apiVersion = reqContext.apiVersion || process.env.FX_API_VERSION || Constants.CURRENT_API_VERSION;

    // If accessToken was provided, setup APIs.
    let forceApi: ForceApi;
    let unitOfWork: UnitOfWork;
    let fxInvocation: FunctionInvocationRequest;
    const logger: Logger = Logger.create(true);
    if (accessToken) {
        const config: ConnectionConfig = new ConnectionConfig(
            accessToken,
            apiVersion,
            userCtx.salesforceBaseUrl
        );
        unitOfWork = new UnitOfWork(config, logger);
        forceApi = new ForceApi(config, logger);

        if (functionInvocationId) {
            fxInvocation = new FunctionInvocationRequest(functionInvocationId, logger, forceApi);
        }
    }

    return new SdkContext(apiVersion,
                          userCtx, 
                          logger, 
                          reqContext.payloadVersion,
                          forceApi, 
                          unitOfWork,
                          fxInvocation);
}

/**
 * Construct sdk UserContext object from the request context
 * 
 * @param reqContext 
 */
function createSdkUserContext(reqContext: any): SdkUseContext {
  const userContext = reqContext.userContext;
  if (!userContext) {
      const message = `UserContext not provided: ${JSON.stringify(reqContext)}`;
      throw new Error(message);
  }

  return new SdkUseContext(
      userContext.orgDomainUrl,
      userContext.orgId,
      userContext.salesforceBaseUrl,
      userContext.username,
      userContext.userId,
      userContext.onBehalfOfUserId
  );
}
