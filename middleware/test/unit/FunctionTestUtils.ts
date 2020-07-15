import { Context } from '@salesforce/salesforce-sdk';
import * as sinon from 'sinon';
import {
    ASYNC_CE_TYPE,
    FN_INVOCATION
} from '../../lib/constants';
import { FunctionInvocationRequest } from '../../lib/FunctionInvocationRequest';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const portHeaderPart = 6666;
export const hostnameHeaderPart = 'whatever';
export const hostHeader = `${hostnameHeaderPart}:${portHeaderPart}`;
export const resource = `http://${hostHeader}`;
export const generateData = (setAccessToken = true, setOnBehalfOfUserId = false, shouldThrowError = false): any => {
    const userContext = {
        orgDomainUrl:'http://sffx-dev-ed.localhost.internal.salesforce.com:6109',
        orgId:'00Dxx0000006GoF',
        salesforceBaseUrl:'http://sffx-dev-ed.localhost.internal.salesforce.com:6109',
        userId:'005xx000001X7dl',
        username:'chris@sffx.org'
    };

    if (setOnBehalfOfUserId) {
        // Workaround readonly prop
        userContext['onBehalfOfUserId'] = '005xx000001X7dy';
    }

    const sfContext = {
        functionInvocationId: '9mdxx00000004ov',
        functionName: 'salesforce/functions/hello',
        requestId: '4SROyqmXwNJ3M40_wnZB1k',
        resource
    };

    if (setAccessToken) {
        sfContext['accessToken'] = `${userContext.orgId}!sdfssfdss`;
    }

    const context = {
        apiVersion:'48.0',
        payloadVersion:'224.1',
        userContext
    };

    const data = {
        context,
        payload:{
            html:null,
            isLightning:false,
            url:'https://sffx-dev-ed.localhost.internal.salesforce.com/apex/MyPdfPage',
            shouldThrowError
        },
        sfContext
    };

    return data;
};

// Encode object -> json -> base64 for use in a CloudEvent 1.0-compliant attribute value, see
// https://salesforce.quip.com/zRyaAi05LhAC#NPNACAeW7lH
export const encodeCeAttrib = (toEncode: any): string => {
    const asJson = JSON.stringify(toEncode);
    return Buffer.from(asJson).toString('base64');
};

export const generateCloudevent = (data: any, async = false, specVersion = '0.2'): any => {
    if (specVersion === '0.2') {
        return {
            id: '00Dxx0000006GY7-4SROyqmXwNJ3M40_wnZB1k',
            contentType: 'application/json',
            type: async ? ASYNC_CE_TYPE : 'com.salesforce.function.invoke',
            schemaURL: null,
            source: 'urn:event:from:salesforce/xx/224.0/00Dxx0000006GY7/InvokeFunctionController/9mdxx00000004ov',
            time: '2019-11-14T18:13:45.627813Z',
            specVersion: specVersion,
            data
        };
    }
    else {
        // A 1.0+ spec CloudEvent will have ONLY the customer data in the data attribute.  Contexts are
        // base64-encoded-json extension attributes.
        return {
            id: '00Dxx0000006GY7-4SROyqmXwNJ3M40_wnZB1k',
            datacontenttype: 'application/json',
            type: async ? ASYNC_CE_TYPE : 'com.salesforce.function.invoke',
            source: 'urn:event:from:salesforce/xx/224.0/00Dxx0000006GY7/InvokeFunctionController/9mdxx00000004ov',
            time: '2019-11-14T18:13:45.627813Z',
            specversion: specVersion,
            sfcontext: encodeCeAttrib(data.context),
            sffncontext: encodeCeAttrib(data.sfContext),
            data: data.payload
        };
    }
};

export const generateRawMiddleWareRequest = (data: any, async = false): any => {
    const cloudEvent: any = generateCloudevent(data, async);
    const rawheaders = {
        'authorization' : 'C2C eyJ2ZXIiOiIxLjAiLCJraWQiOiJDT1J',
        'content-type' : [ 'application/json' ],
        X_FORWARDED_HOST : hostHeader, // test case insensitive lookup
        X_FORWARDED_PROTO: 'http'
    };
    return {
        headers: rawheaders,
        payload: cloudEvent
    };
};

export class FakeFunction {

    public initParams: any;
    public invokeParams: any;
    public errors: string[];

    constructor(public sandbox: sinon.SinonSandbox, private doFnInvocation: boolean = false) {
        this.errors = [];
    }

    public getName(): string {
        return this.constructor.name;
    }

    public invoke(event:any, context: Context): Promise<any> {
        this.invokeParams = { context, event };

        if (this.doFnInvocation) {
            const fnInvocationRequest: FunctionInvocationRequest = context[FN_INVOCATION];
            fnInvocationRequest.response = '{}';
            fnInvocationRequest.save();
        }

        return Promise.resolve('OK');
    }
}
