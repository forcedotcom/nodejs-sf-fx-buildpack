import * as sdk from '@heroku/salesforce-sdk';

// TODO: Migrate to an Evergreen middleware layer.  Convenience method to not dupe
// code across existing functions.
// Once SF middleware is in place, the event param will be the function's
// payload and context will be a fully setup sdk.Context instance.
// Until then, event is a CloudEvent object that we'll parse either to
// setup sdk.Context.

/**
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
 * 
 * @param event 
 * @param state -- not used as an input here
 * @param resultArgs -- not used as an input here
 */

export default function applySfFxMiddleware(event: any, state: any, resultArgs: any): any {
    debugger;
    console.log("I am in the middle ware");
    if (!event) {
        throw new Error('Data not provided');
    }

    const data = event.payload.data;
    if (!data) {
        throw new Error('Data not provided');
    }

    // Again, this is temp: context param will be fully setup sdk.Context instance.
    const context = data.context;
    if (!context) {
        throw new Error('Context not provided');
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

    // Transformed CloudEvent into function consumable payload (event) and context.
    // return {
    //     context: sdk.Context.create(context, sdk.Logger.create(true), accessToken, functionInvocationId),
    //     event: data.payload };

    let sdkContext = sdk.Context.create(context, 
                                        sdk.Logger.create(true), 
                                        accessToken, 
                                        functionInvocationId);
    return [event.payload, sdkContext];
}

