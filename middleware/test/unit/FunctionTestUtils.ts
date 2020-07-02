import { Context } from '@salesforce/salesforce-sdk';
import * as sinon from 'sinon';

export const portHeaderPart = 6666;
export const hostnameHeaderPart = 'whatever';
export const hostHeader = `${hostnameHeaderPart}:${portHeaderPart}`;
export const resource = `http://${hostHeader}`;
export const generateData = (setAccessToken = true, setOnBehalfOfUserId = false): any => {
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
            url:'https://sffx-dev-ed.localhost.internal.salesforce.com/apex/MyPdfPage'
        },
        sfContext
    };

    return data;
};

export const generateCloudevent = (data: any, async = false): any => {
    return {
        id: '00Dxx0000006GY7-4SROyqmXwNJ3M40_wnZB1k',
        contentType: 'application/json',
        type: `com.salesforce.function.${async ? 'async' : 'sync'}`,
        schemaURL: null,
        source: 'urn:event:from:salesforce/xx/224.0/00Dxx0000006GY7/InvokeFunctionController/9mdxx00000004ov',
        time: '2019-11-14T18:13:45.627813Z',
        specVersion: '0.2',
        data
    };
};

export const generateRawMiddleWareRequest = (data: any, async = false): any => {
    const cloudEvent: any = generateCloudevent(data, async);
    const rawheaders = {
        'authorization' : 'C2C eyJ2ZXIiOiIxLjAiLCJraWQiOiJDT1J',
        'content-type' : [ 'application/json' ],
        'x-forwarded-host' : hostHeader, // test case insensitive lookup
        'x-forwarded-proto': 'http'
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

    public getName() {
        return this.constructor.name;
    }

    public invoke(event:any, context: Context): Promise<any> {
        this.invokeParams = { context, event };

        if (this.doFnInvocation) {
            context['fnInvocation'].response = '{}';
            context['fnInvocation'].save();
        }

        return Promise.resolve(null);
    }
}
