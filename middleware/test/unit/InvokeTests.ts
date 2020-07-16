/* tslint:disable: no-unused-expression */
import { assert, expect, use } from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import 'mocha';
import * as request from 'request-promise-native';
import * as sinon from 'sinon';
import { Context, Logger, Org, User } from '@salesforce/salesforce-sdk';

use(chaiAsPromised);

import { 
    FakeFunction, 
    generateCloudevent, 
    generateData, 
    generateRawMiddleWareRequest, 
    hostHeader,
    hostnameHeaderPart,
    portHeaderPart 
} from './FunctionTestUtils';
import { Message } from '@projectriff/message';
const http = require('http');
const https = require('https');
const PassThrough = require('stream').PassThrough;
import systemFn from '../../index';
import {applySfFnMiddleware} from '../../lib/sfMiddleware';
import {
    ASYNC_FULFILL_HEADER,
    FN_INVOCATION,
    X_FORWARDED_HOST,
    X_FORWARDED_PROTO
} from '../../lib/constants';
import * as fnInvRequest from '../../lib/FunctionInvocationRequest';

interface PdfEvent {
    html?: string,
    url?:  string,
    isLightning?: boolean,
    pdf?: {
        printBackground?: boolean
        displayHeaderFooter?: boolean
    },
    browser?: {
        headless?: boolean, /* allow for testing purposes */
    }
}

const LOGGER = new Logger({name: 'test', level: 100});

//   T E S T S

describe('Invoke Function Tests', () => {

    const specVersions = ['0.2', '1.0'];

    // Function params
    let data: any;
    let rawRequest: any;

    let sandbox: sinon.SinonSandbox;
    let mockRequestPost;

    const newFakeFn = (doFnInvocation = false): FakeFunction => {
        return new FakeFunction(sandbox, doFnInvocation);
    };

    const postInvokeAsserts = (fakeFn: FakeFunction): void => {
        assert(fakeFn.errors.length === 0, fakeFn.errors.join());
        assert(fakeFn.invokeParams.context && fakeFn.invokeParams.event);
        assert(fakeFn.invokeParams.context instanceof Context);
    };

    beforeEach(() => {
        sandbox = sinon.createSandbox();

        data = generateData(true);
        rawRequest = generateRawMiddleWareRequest(data);

        // Request
        mockRequestPost = sandbox.stub(request, 'post');
        mockRequestPost.resolves(Promise.resolve({}));
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('middleware should setup event and context objects', async () => {
        // data generated above
        expect(data.context).to.exist;
        expect(data.payload).to.exist;
        expect(data.sfContext).to.exist;

        // cloudevent generated above
        // Until middleware is in place, context passed to function is not provide
        const middlewareResult = applySfFnMiddleware(rawRequest, LOGGER);
        expect(middlewareResult).to.exist;

        const event = middlewareResult[0];
        expect(event).to.exist;
        expect(event.data).to.exist;
        expect(event.data.url).to.exist;
        expect(event.data.sfContext).to.not.exist;

        const context = middlewareResult[1];
        expect(context).to.exist;
        expect(context.org).to.exist;
        expect(context.org.user).to.exist;
        expect(context.logger).to.exist;
        expect(context.org.data).to.exist;
        expect(context.org.unitOfWork).to.exist;
        expect(context.fnInvocation).to.exist;
    });

    it('should invoke function', async () => {
        const transformedParams = applySfFnMiddleware(rawRequest, LOGGER);
        const event = transformedParams[0];
        const context = transformedParams[1];

        // Create and invoke function
        const fakeFn: FakeFunction = newFakeFn();
        await fakeFn.invoke(event, context);

        // Validate
        postInvokeAsserts(fakeFn);
        const paramContext: Context = fakeFn.invokeParams.context;

        expect(context.fnInvocation.id).to.equal(paramContext[FN_INVOCATION].id);
        const org: Org = fakeFn.invokeParams.context.org;
        expect(context.org.id).to.equal(org.id);
        const user: User = fakeFn.invokeParams.context.org.user;
        expect(context.org.user.id).to.equal(user.id);
        return Promise.resolve(null);
    });

    it('should have payload', async () => {
        const transformedParams = applySfFnMiddleware(rawRequest, LOGGER);
        const event = transformedParams[0];
        const context = transformedParams[1];

        // Create and invoke function
        const fakeFn: FakeFunction = newFakeFn();
        await fakeFn.invoke(event, context);

        // Validate
        postInvokeAsserts(fakeFn);
        // Validate Cloudevent instance payload;
        const pdfPayload: PdfEvent = fakeFn.invokeParams.event;
        expect(event.url).to.equal(pdfPayload.url);

        return Promise.resolve(null);
    });

    it('should handle FunctionInvocation - https', async () => {
        const transformedParams = applySfFnMiddleware(rawRequest, LOGGER);
        const event = transformedParams[0];
        const context = transformedParams[1];

        const updateStub = sandbox.stub(context.org.data, 'update');
        updateStub.callsFake((): Promise<any> => {
            return Promise.resolve({ success: true });
        });

        const queryStub = sandbox.stub(context.org.data, 'query');

        // Create and invoke function
        const fakeFn: FakeFunction = newFakeFn(true);
        await fakeFn.invoke(event, context);

        sandbox.assert.calledOnce(queryStub);
        sandbox.assert.calledOnce(updateStub);
        const updatedFunctionInvocationRequest = updateStub.getCall(0).args[0];
        expect(updatedFunctionInvocationRequest).to.be.not.undefined;
        expect(updatedFunctionInvocationRequest).to.be.not.null;
        expect(updatedFunctionInvocationRequest).has.property('referenceId');
        expect(updatedFunctionInvocationRequest).has.property('sObjectType');
        expect(updatedFunctionInvocationRequest.sObjectType).to.eql('FunctionInvocationRequest');
        expect(updatedFunctionInvocationRequest).has.property('values');
        const values = updatedFunctionInvocationRequest.values;
        expect(values).to.be.not.undefined;
        expect(values).to.be.not.null;
        expect(values.ResponseBody).to.be.not.undefined;
        expect(values.ResponseBody).to.be.not.null;

        return Promise.resolve(null);
    });

    specVersions.forEach(function(specVersion : string) {

        it('should handle async invocation - http, specVersion=' + specVersion, async () => {
            let receivedOptions;
            const mockRequest = new PassThrough();
            const requestWriteSpy = sandbox.stub(mockRequest, 'write');
            const httpRequestStub = sandbox.stub(http, 'request');
            httpRequestStub.callsFake((options): any => {
                receivedOptions = options;
                return mockRequest;
            });
            // Should not be called
            const httpsRequestStub = sandbox.stub(https, 'request');

            const cloudEventRequest = generateCloudevent(generateData(), true, specVersion);
            const fnResult = await systemFn(Message.builder()
                .addHeader('content-type', 'application/json')
                .addHeader(X_FORWARDED_HOST.toUpperCase(), hostHeader) // test case insenstive
                .addHeader(X_FORWARDED_PROTO, 'http')
                .payload(cloudEventRequest)
                .build());
            expect(httpsRequestStub.called).to.be.false;
            expect(fnResult).to.be.not.undefined;
            expect(fnResult).to.be.not.null;
            expect(fnResult.headers).to.be.exist;
            expect(fnResult.headers.getValue('x-http-status')).to.be.eq('202');
            expect(receivedOptions).to.be.not.undefined;
            expect(receivedOptions).to.be.not.null;
            expect(receivedOptions.hostname).to.be.eq(hostnameHeaderPart);
            expect(receivedOptions.port).to.be.eq(portHeaderPart);
            expect(receivedOptions.method).to.be.eq('POST');
            const headers = receivedOptions.headers;
            expect(headers).to.be.not.undefined;
            expect(headers).to.be.not.null;
            expect(headers[ASYNC_FULFILL_HEADER]).to.be.true;
            expect(requestWriteSpy.calledOnce).to.be.true;

            return Promise.resolve(null);
        });

        it('should handle initial async invocation - https, specVersion=' + specVersion, async () => {
            let receivedOptions;
            const mockRequest = new PassThrough();
            const requestWriteSpy = sandbox.stub(mockRequest, 'write');
            const httpsRequestStub = sandbox.stub(https, 'request');
            httpsRequestStub.callsFake((options): any => {
                receivedOptions = options;
                return mockRequest;
            });
            // Should not be called
            const httpRequestStub = sandbox.stub(http, 'request');

            const host = 'sparrow-1a3ebmr.okra-ms2twzu6no.castle-7d6622.evergreen.space';
            const cloudEventRequest = generateCloudevent(generateData(), true, specVersion);
            const fnResult = await systemFn(Message.builder()
                .addHeader('content-type', 'application/json')
                .addHeader(X_FORWARDED_HOST, host) // test case insenstive
                .payload(cloudEventRequest)
                .build());
            expect(httpRequestStub.called).to.be.false;
            expect(fnResult).to.be.not.undefined;
            expect(fnResult).to.be.not.null;
            expect(fnResult.headers).to.be.exist;
            expect(fnResult.headers.getValue('x-http-status')).to.be.eq('202');
            expect(receivedOptions).to.be.not.undefined;
            expect(receivedOptions).to.be.not.null;
            expect(receivedOptions.hostname).to.be.eq(host);
            expect(receivedOptions.port).to.be.eq(443);
            expect(receivedOptions.method).to.be.eq('POST');
            const headers = receivedOptions.headers;
            expect(headers).to.be.not.undefined;
            expect(headers).to.be.not.null;
            expect(headers[ASYNC_FULFILL_HEADER]).to.be.true;
            expect(requestWriteSpy.calledOnce).to.be.true;

            return Promise.resolve(null);
        });

        it('should handle initial async invocation - error, specVersion=' + specVersion, async () => {
            const host = '127.0.0.1';
            const cloudEventRequest = generateCloudevent(generateData(), true, specVersion);
            const fnResult = await systemFn(Message.builder()
                .addHeader('content-type', 'application/json')
                .addHeader(X_FORWARDED_HOST, host) // test case insenstive
                .payload(cloudEventRequest)
                .build());
            expect(fnResult).to.be.not.undefined;
            expect(fnResult).to.be.not.null;
            expect(fnResult.headers).to.be.exist;
            expect(fnResult.headers.getValue('x-http-status')).to.be.eq('500');

            return Promise.resolve(null);
        });

        it('should handle async invocation fulfillment - success, specVersion=' + specVersion, async () => {
            let gotFnInvocation;
            let gotResponse;
            const saveFnInvocationStub = sandbox.stub(fnInvRequest, 'saveFnInvocation');
            saveFnInvocationStub.callsFake(async (logger: Logger,
                fnInvocation: fnInvRequest.FunctionInvocationRequest,
                response: any,
                status): Promise<void> => {
                    gotFnInvocation = fnInvocation;
                    gotResponse = response;
                    return Promise.resolve(null)
            });

            const cloudEventRequest = generateCloudevent(generateData(), true, specVersion);
            const fnResult = await systemFn(Message.builder()
                .addHeader('content-type', 'application/json')
                .addHeader(ASYNC_FULFILL_HEADER, 'true')
                .payload(cloudEventRequest)
                .build());
            expect(fnResult).to.deep.equal({success: true});
            expect(saveFnInvocationStub.calledOnce).to.be.true;
            expect(gotFnInvocation).to.be.not.undefined;
            expect(gotFnInvocation.id).to.be.not.undefined;
            expect(gotResponse).to.deep.equal({success: true});

            return Promise.resolve(null);
        });

        it('should handle async invocation fulfillment - error, specVersion=' + specVersion, async () => {
            let gotFnInvocation;
            let gotResponse;
            const saveFnInvocationErrorStub = sandbox.stub(fnInvRequest, 'saveFnInvocationError');
            saveFnInvocationErrorStub.callsFake(async (logger: Logger,
                fnInvocation: fnInvRequest.FunctionInvocationRequest,
                response: any): Promise<void> => {
                    gotFnInvocation = fnInvocation;
                    gotResponse = response;
                    return Promise.resolve(null)
            });

            const cloudEventRequest = generateCloudevent(generateData(true, false, true), true, specVersion);
            const fnResult = await systemFn(Message.builder()
                .addHeader('content-type', 'application/json')
                .addHeader(ASYNC_FULFILL_HEADER, 'true')
                .payload(cloudEventRequest)
                .build());
            expect(fnResult).to.be.not.undefined;
            expect(fnResult).to.be.not.null;
            expect(fnResult.headers).to.be.exist;
            expect(fnResult.headers.getValue('x-http-status')).to.be.eq('500');
            expect(fnResult.payload).to.deep.equal({ error: 'Error: FakeError' });
            expect(saveFnInvocationErrorStub.calledOnce).to.be.true;
            expect(gotFnInvocation).to.be.not.undefined;
            expect(gotFnInvocation.id).to.be.not.undefined;
            expect(gotResponse).to.deep.equal('FakeError');

            return Promise.resolve(null);
        });
    })
});
