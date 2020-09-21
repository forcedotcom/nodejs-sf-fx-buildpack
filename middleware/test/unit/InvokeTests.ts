/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
import {assert, expect, use} from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import 'mocha';
import * as request from 'request-promise-native';
import * as sinon from 'sinon';
import {Context, Logger, Org, User} from '@salesforce/salesforce-sdk';
import {CloudEvent, Headers as CEHeaders} from 'cloudevents';

use(chaiAsPromised);

import {
    FakeFunction,
    generateCloudevent,
    generateData,
    generateCloudEventObjs,
    hostHeader,
    hostnameHeaderPart,
    portHeaderPart
} from './FunctionTestUtils';
import {Message} from '@projectriff/message';
const http = require('http');
const https = require('https');
const PassThrough = require('stream').PassThrough;
//import require('../../index') from '../../index';
import {applySfFnMiddleware} from '../../lib/sfMiddleware';
import {FN_INVOCATION} from '../../lib/constants';
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

    const specVersions = ['0.3', '1.0'];

    // Function params
    let data: any;
    let cloudEvent: CloudEvent;
    let headers: CEHeaders;

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
        [cloudEvent, headers] = generateCloudEventObjs(data);

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
        const middlewareResult = applySfFnMiddleware(cloudEvent, headers, LOGGER);
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
        const transformedParams = applySfFnMiddleware(cloudEvent, headers, LOGGER);
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
        const transformedParams = applySfFnMiddleware(cloudEvent, headers, LOGGER);
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

    it('should handle FunctionInvocation', async () => {
        const transformedParams = applySfFnMiddleware(cloudEvent, headers, LOGGER);
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

        it('should handle invocation - https, specVersion=' + specVersion, async () => {
            const cloudEventRequest = generateCloudevent(generateData(), true, specVersion);
            const fnResult = await require('../../index').default(Message.builder()
                .addHeader('content-type', 'application/json')
                .payload(cloudEventRequest.toJSON())
                .build());
            expect(fnResult).to.be.not.undefined;
            expect(fnResult).to.be.not.null;
            expect(fnResult.headers).to.be.not.null;
            expect(fnResult.headers.getValue('x-http-status')).to.be.equal('200');
            expect(fnResult.headers.getValue('x-extra-info')).to.be.not.null;
            const extraInfo = JSON.parse(fnResult.headers.getValue('x-extra-info'));
            expect(extraInfo.requestId).to.not.be.empty;
            expect(extraInfo.source).to.not.be.empty;
            expect(extraInfo.execTimeMs).to.be.above(0);
            expect(extraInfo.stack).to.have.lengthOf(0);
            expect(fnResult.payload).to.be.equal(JSON.stringify({ success: true }));
        });

        it('should handle invocation - internal error (before function invocation), specVersion=' + specVersion, async () => {
            const cloudEventRequest = generateCloudevent(generateData(), true, specVersion);
            delete cloudEventRequest.data;
            const fnResult = await require('../../index').default(Message.builder()
                .addHeader('content-type', 'application/json')
                .payload(cloudEventRequest) // not toJSON to cause parse error
                .build());
            expect(fnResult).to.be.not.undefined;
            expect(fnResult).to.be.not.null;
            expect(fnResult.headers.getValue('x-http-status')).to.be.equal('503');
            expect(fnResult.headers.getValue('x-extra-info')).to.be.not.null;
            const extraInfo = JSON.parse(fnResult.headers.getValue('x-extra-info'));
            expect(extraInfo.requestId).to.not.be.empty;
            expect(extraInfo.source).to.not.be.empty;
            expect(extraInfo.execTimeMs).to.be.equal(-1);  // function was not invoked
            expect(extraInfo.stack).to.not.be.empty
            expect(extraInfo.stack).to.contain('applySfFnMiddleware');
            expect(extraInfo.stack).to.contain('%20'); // URI encoded
            expect(decodeURI(extraInfo.stack)).to.contain('Error: Data field of the cloudEvent not provided in the request');
        });

        it('should handle invocation - function error, specVersion=' + specVersion, async () => {
            const cloudEventRequest = generateCloudevent(generateData(true, false, true), true, specVersion);
            const fnResult = await require('../../index').default(Message.builder()
                .addHeader('content-type', 'application/json')
                .payload(cloudEventRequest.toJSON())
                .build());
            expect(fnResult).to.be.not.undefined;
            expect(fnResult).to.be.not.null;
            expect(fnResult.headers.getValue('x-http-status')).to.be.equal('500');
            expect(fnResult.headers.getValue('x-extra-info')).to.be.not.null;
            const extraInfo = JSON.parse(fnResult.headers.getValue('x-extra-info'));
            expect(extraInfo.requestId).to.not.be.empty;
            expect(extraInfo.source).to.not.be.empty;
            expect(extraInfo.execTimeMs).to.be.above(0);
            expect(extraInfo.stack).to.not.be.empty
            expect(extraInfo.stack).to.contain('FakeError');
        });
    });
});
