import {Message} from '@projectriff/message';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const portHeaderPart = 6666;
export const hostnameHeaderPart = 'whatever';
export const hostHeader = `${hostnameHeaderPart}:${portHeaderPart}`;
export const resource = `http://${hostHeader}`;
export const generateData = (shouldThrowError = false): object => {
  return {
    html: null,
    isLightning: false,
    url: 'https://sffx-dev-ed.localhost.internal.salesforce.com/apex/MyPdfPage',
    shouldThrowError
  };
};

// Encode object -> json -> base64 for use in a CloudEvent 1.0-compliant attribute value, see
// https://salesforce.quip.com/zRyaAi05LhAC#NPNACAeW7lH
export const encodeCeAttrib = (toEncode: any): string => {
    const asJson = JSON.stringify(toEncode);
    return Buffer.from(asJson).toString('base64');
};

export const generateRequestMessage = (data?: object, omitSpecVersion = false): object => {
    const sfcontext = encodeCeAttrib({
        apiVersion:'50.0',
        payloadVersion:'224.1',
        accessToken: '00Dxx0000006GoF!sdfssfdss',
        userContext: {
          orgDomainUrl:'http://sffx-dev-ed.localhost.internal.salesforce.com:6109',
          orgId:'00Dxx0000006GoF',
          salesforceBaseUrl:'http://sffx-dev-ed.localhost.internal.salesforce.com:6109',
          userId:'005xx000001X7dl',
          username:'chris@sffx.org'
        }
    });

    const sffncontext = encodeCeAttrib({
        functionInvocationId: '9mdxx00000004ov',
        functionName: 'salesforce/functions/hello',
        requestId: '4SROyqmXwNJ3M40_wnZB1k',
        resource
    });

    let result = Message.builder()
                  .addHeader('content-type', 'application/json')
                  .addHeader('ce-id', '00Dxx0000006GY7-4SROyqmXwNJ3M40_wnZB1k')
                  .addHeader('ce-datacontenttype', 'application/json')
                  .addHeader('ce-type', 'com.salesforce.function.invoke')
                  .addHeader('ce-schemaurl', '')
                  .addHeader('ce-source', 'urn:event:from:salesforce/xx/224.0/00Dxx0000006GY7/InvokeFunctionController/9mdxx00000004ov')
                  .addHeader('ce-time', '2019-11-14T18:13:45.627813Z')
                  .addHeader('ce-sfcontext', sfcontext)
                  .addHeader('ce-sffncontext', sffncontext)

    if (!omitSpecVersion) {
      result = result.addHeader('ce-specversion', '1.0')
    }

    if (data) {
      result = result.payload(data)
    }

    return result.build()
};
