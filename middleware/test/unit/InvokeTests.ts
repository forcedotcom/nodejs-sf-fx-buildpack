/* tslint:disable: no-unused-expression */
import { assert, expect, use } from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import 'mocha';
import * as request from 'request-promise-native';
import * as sinon from 'sinon';

use(chaiAsPromised);

import applySfFxMiddleware from '../../index';
import { Context, Logger, Org, User } from '@salesforce/salesforce-sdk';
import { FakeFunction, generateData, generateRawMiddleWareRequest} from './FunctionTestUtils';


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

    // Function params
    let data: any;
    let rawRequest: any;

    let sandbox: sinon.SinonSandbox;
    let mockRequestPost;

    const newFakeFx = (doFxInvocation = false): FakeFunction => {
        return new FakeFunction(sandbox, doFxInvocation);
    };

    const postInvokeAsserts = (fakeFx: FakeFunction): void => {
        assert(fakeFx.errors.length === 0, fakeFx.errors.join());
        assert(fakeFx.invokeParams.context && fakeFx.invokeParams.event);
        assert(fakeFx.invokeParams.context instanceof Context);
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
        const middlewareResult = applySfFxMiddleware(rawRequest, {}, [LOGGER]);
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
        expect(context.fxInvocation).to.exist;
    });

    it('should invoke function', async () => {
        const transformedParams = applySfFxMiddleware(rawRequest, {}, [LOGGER]);
        const event = transformedParams[0];
        const context = transformedParams[1];

        // Create and invoke function
        const fakeFx: FakeFunction = newFakeFx();
        await fakeFx.invoke(event, context);

        // Validate
        postInvokeAsserts(fakeFx);
        const paramContext: Context = fakeFx.invokeParams.context;

        expect(context.fxInvocation.id).to.equal(paramContext['fxInvocation'].id);
        const org: Org = fakeFx.invokeParams.context.org;
        expect(context.org.id).to.equal(org.id);
        const user: User = fakeFx.invokeParams.context.org.user;
        expect(context.org.user.id).to.equal(user.id);
        return Promise.resolve(null);
    });

    it('should have payload', async () => {
        const transformedParams = applySfFxMiddleware(rawRequest, {}, [LOGGER]);
        const event = transformedParams[0];
        const context = transformedParams[1];

        // Create and invoke function
        const fakeFx: FakeFunction = newFakeFx();
        await fakeFx.invoke(event, context);

        // Validate
        postInvokeAsserts(fakeFx);
        // Validate Cloudevent instance payload;
        const pdfPayload: PdfEvent = fakeFx.invokeParams.event;
        expect(event.url).to.equal(pdfPayload.url);

        return Promise.resolve(null);
    });

    it('should handle FunctionInvocation', async () => {
        const transformedParams = applySfFxMiddleware(rawRequest, {}, [LOGGER]);
        const event = transformedParams[0];
        const context = transformedParams[1];

        const updateStub = sandbox.stub(context.org.data, 'update');
        updateStub.callsFake((): Promise<any> => {
            return Promise.resolve({ success: true });
        });

        const queryStub = sandbox.stub(context.org.data, 'query');

        // Create and invoke function
        const fakeFx: FakeFunction = newFakeFx(true);
        await fakeFx.invoke(event, context);

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
});
