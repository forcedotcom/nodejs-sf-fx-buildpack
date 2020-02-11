/* tslint:disable: no-unused-expression */
import { expect } from 'chai';
import 'mocha';

import { Constants, Context, ConnectionConfig, Logger} from '@salesforce/salesforce-sdk';
import { generateData, generateRawMiddleWareRequest } from './FunctionTestUtils';
import applySfFxMiddleware from '../../index';

describe('Context Tests', () => {

    const validateContext = (data: any, context: Context, hasOnBehalfOfUserId: boolean = false) => {
        expect(context.apiVersion).to.exist;
        expect(context.apiVersion).to.equal(Constants.CURRENT_API_VERSION);

        expect(context.userContext).to.exist;
        expect(context.userContext.orgDomainUrl).to.equal(data.context.userContext.orgDomainUrl);
        expect(context.userContext.orgId).to.equal(data.context.userContext.orgId);
        expect(context.userContext.salesforceBaseUrl).to.equal(data.context.userContext.salesforceBaseUrl);
        expect(context.userContext.username).to.equal(data.context.userContext.username);
        expect(context.userContext.userId).to.equal(data.context.userContext.userId);

        if (hasOnBehalfOfUserId) {
            expect(context.userContext.onBehalfOfUserId).to.equal(data.context.userContext.onBehalfOfUserId);
        } else {
            expect(context.userContext.onBehalfOfUserId).to.be.undefined;
        }
    };

    /**
     * validate the result of the applyMiddleWare, it should have 2 parameters in an array
     * the 1st is the user function payload
     * the 2nd is the sdk context
     *
     * @param expectedPayload
     * @param middlewareResult
     */
    const validateApplyMiddleWareResult = (data: any, middlewareResult : any) => {
        expect(middlewareResult).to.be.an('array');
        expect(middlewareResult).to.have.lengthOf(2);
        expect(middlewareResult[0]).to.exist;
        expect(middlewareResult[1]).to.exist;

        //validate user function payload
        const expectedPayload:any = data.payload;
        expect(middlewareResult[0].html).to.equal(expectedPayload.html);
        expect(middlewareResult[0].isLightning).to.equal(expectedPayload.isLightning);
        expect(middlewareResult[0].url).to.equal(expectedPayload.url);

        //sfContext is removed
        expect(data.sfContext).to.not.exist;
    };

    const getSdkContext = (data: any) : Context => {
        const rawRequest = generateRawMiddleWareRequest(data);
        const logger = new Logger('Evergreen Logger Context Unit Test');
        const mwResult: any = applySfFxMiddleware(rawRequest, {}, [logger]);
        validateApplyMiddleWareResult(data, mwResult);

        const context: Context = mwResult[1] as Context;
        return context;
    };

    it('validate context WITH accessToken', async () => {
        const data = generateData(true, true);
        expect(data.context).to.exist;
        expect(data.context.apiVersion).to.exist;
        expect(data.sfContext.accessToken).to.exist;
        expect(data.sfContext.functionInvocationId).to.exist;
        const fxInvocationId: string = data.sfContext.functionInvocationId;
        const accessToken: string = data.sfContext.accessToken;

        const context: Context = getSdkContext(data);
        validateContext(data, context, true);

        // Requires accessToken
        expect(context.forceApi).to.exist;
        expect(context.unitOfWork).to.exist;
        expect(context['fxInvocation']).to.exist;
        expect(context['fxInvocation'].id).to.equal(fxInvocationId);

        // Validate ConnectionConfig has expected values
        // TODO: Prevent this, somehow.
        const connConfig: ConnectionConfig = context.forceApi['connConfig'];
        expect(connConfig).to.exist;
        // TODO: Prevent access to accessToken
        expect(connConfig.accessToken).to.equal(accessToken);
        expect(connConfig.apiVersion).to.equal(data.context.apiVersion);
        expect(connConfig.instanceUrl).to.equal(data.context.userContext.salesforceBaseUrl);

        // Ensure accessToken was not serialized
        const forceApiJSON = JSON.stringify(context.forceApi);
        expect(forceApiJSON).to.exist;
        expect(forceApiJSON).to.not.contain('accessToken');

        // Validate Connection has expected values
        // TODO: Prevent this, somehow.
        const conn = context.forceApi['connect']();
        expect(conn).to.exist;
        // TODO: Prevent access to accessToken
        expect(conn.accessToken).to.equal(accessToken);
        expect(conn.version).to.equal(data.context.apiVersion);
        expect(conn.instanceUrl).to.equal(data.context.userContext.salesforceBaseUrl);
    });

    it('validate context WITHOUT accessToken', async () => {
        const data = generateData(false);
        expect(data.context).to.exist;

        const context: Context = getSdkContext(data);
        validateContext(data, context);

        // Requires accessToken
        expect(context.forceApi).to.not.exist;
        expect(context.unitOfWork).to.not.exist;
        expect(context['fxInvocation']).to.not.exist;
    });

    it('validate API version override', async () => {
        const data = generateData(true);
        expect(data.context).to.exist;
        expect(data.context.apiVersion).to.exist;
        data.context.apiVersion = '0.0'

        const context: Context = getSdkContext(data);
        expect(context.apiVersion).to.exist;
        expect(context.apiVersion).to.equal('0.0');
    });

    it('should FAIL to create Context', async () => {
        try {
            // Expecting missing data.context
            const context: Context = getSdkContext({});
            expect.fail();
        } catch (err) {
            expect(err.message).to.contain('Context not provided in data');
        }

        return Promise.resolve(null);
    });
});
