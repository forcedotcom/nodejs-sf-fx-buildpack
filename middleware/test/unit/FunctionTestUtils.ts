import * as sinon from 'sinon';
import {FN_INVOCATION} from '../../lib/constants';

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

export const generateCloudevent = (data: any, sfContext?: object, sfFnContext?: object): object => {
    const sfcontext = encodeCeAttrib(sfContext || {
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

    const sffncontext = encodeCeAttrib(sfFnContext || {
        functionInvocationId: '9mdxx00000004ov',
        functionName: 'salesforce/functions/hello',
        requestId: '4SROyqmXwNJ3M40_wnZB1k',
        resource
    });

    return {
        specversion: '1.0',
        id: '00Dxx0000006GY7-4SROyqmXwNJ3M40_wnZB1k',
        datacontenttype: 'application/json',
        type: 'com.salesforce.function.invoke',
        schemaurl: '',
        source: 'urn:event:from:salesforce/xx/224.0/00Dxx0000006GY7/InvokeFunctionController/9mdxx00000004ov',
        time: '2019-11-14T18:13:45.627813Z',
        data,
        sfcontext,
        sffncontext
    };
};

export const generateCloudEventObjs = (data: any): [object, Map<string, ReadonlyArray<string>>] => {
    const cloudEvent = generateCloudevent(data);
    const headers = new Map();
    headers.set('authorization', ['C2C eyJ2ZXIiOiIxLjAiLCJraWQiOiJDT1J']);
    headers.set('content-type', ['application/json']);
    headers.set('X_FORWARDED_HOST', [hostHeader]); // test case insensitive lookup
    headers.set('X_FORWARDED_PROTO', 'http');
    return [cloudEvent, headers];
};

export class FakeFunction {
    public lastEvent: any;
    public lastContext: any;
    public lastLogger: any;

    public invoke(event: any, context: object, logger: object): Promise<any> {
        this.lastEvent = event;
        this.lastContext = context;
        this.lastLogger = logger;
        return Promise.resolve('OK');
    }
}
