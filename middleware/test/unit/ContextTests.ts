/* eslint-disable @typescript-eslint/no-explicit-any */
import {LoggerLevel} from '@salesforce/core';
import {APIVersion, ConnectionConfig, Context, Logger} from '@salesforce/salesforce-sdk';
import {expect} from 'chai';
import * as fs from 'fs';
import 'mocha';
import * as sinon from 'sinon';

import {generateData, generateCloudEventObjs} from './FunctionTestUtils';

import {applySfFnMiddleware} from '../../lib/sfMiddleware';
import {FN_INVOCATION} from '../../lib/constants';

describe('Context Tests', () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    const validateContext = (data: any, context: Context, hasOnBehalfOfUserId = false): void => {
        expect(context.org.apiVersion).to.exist;
        expect(context.org.apiVersion).to.equal(APIVersion.V50.toString());

        expect(context.org.user).to.exist;
        expect(context.org.domainUrl).to.equal(data.context.userContext.orgDomainUrl);
        expect(context.org.id).to.equal(data.context.userContext.orgId);
        expect(context.org.baseUrl).to.equal(data.context.userContext.salesforceBaseUrl);
        expect(context.org.user.username).to.equal(data.context.userContext.username);
        expect(context.org.user.id).to.equal(data.context.userContext.userId);
        expect(context.secrets).to.exist;

        if (hasOnBehalfOfUserId) {
            expect(context.org.user.onBehalfOfUserId).to.equal(data.context.userContext.onBehalfOfUserId);
        } else {
            expect(context.org.user.onBehalfOfUserId).to.be.undefined;
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
    const validateApplyMiddleWareResult = (data: any, middlewareResult : any): void => {
        expect(middlewareResult).to.be.an('array');
        expect(middlewareResult).to.have.lengthOf(3);
        expect(middlewareResult[0]).to.exist;
        expect(middlewareResult[1]).to.exist;
        expect(middlewareResult[2]).to.exist;

        const event = middlewareResult[0];
        expect(event.id).to.not.be.undefined;
        expect(event.type).to.not.be.undefined;
        expect(event.source).to.not.be.undefined;
        expect(event.dataContentType).to.not.be.undefined;
        expect(event.dataContentType).to.equal('application/json');
        expect(event.dataSchema).to.not.be.undefined;
        expect(event.data).to.not.be.undefined;
        expect(event.headers).to.not.be.undefined;

        // validate user function payload
        const expectedPayload: any = event.data;
        expect(data.payload.html).to.equal(expectedPayload.html);
        expect(data.payload.isLightning).to.equal(expectedPayload.isLightning);
        expect(data.payload.url).to.equal(expectedPayload.url);

        // sfContext is removed
        expect(data.sfContext).to.not.exist;
    };

    const getContext = (data: any) : Context => {
        const [cloudEvent, headers] = generateCloudEventObjs(data);
        const logger = new Logger('Evergreen Logger Context Unit Test');
        const mwResult: any = applySfFnMiddleware(cloudEvent, headers, logger);
        validateApplyMiddleWareResult(data, mwResult);

        const context: Context = mwResult[1] as Context;
        return context;
    };

    it('validate context WITH accessToken', () => {
        const data = generateData(true, true);
        expect(data.context).to.exist;
        expect(data.context.apiVersion).to.exist;
        expect(data.sfContext.accessToken).to.exist;
        expect(data.sfContext.functionInvocationId).to.exist;
        const fnInvocationId: string = data.sfContext.functionInvocationId;
        const accessToken: string = data.sfContext.accessToken;

        const context: Context = getContext(data);
        validateContext(data, context, true);

        // Requires accessToken
        expect(context.org.data).to.exist;
        expect(context.org.unitOfWork).to.exist;
        expect(context.org.unitOfWorkGraph).to.exist;       //apiVersion needs to be at least 50.0
        expect(context[FN_INVOCATION]).to.exist;
        expect(context[FN_INVOCATION].id).to.equal(fnInvocationId);

        // Validate ConnectionConfig has expected values
        // TODO: Prevent this, somehow.
        const connConfig: ConnectionConfig = context.org.data['connConfig'];
        expect(connConfig).to.exist;
        // TODO: Prevent access to accessToken
        expect(connConfig.accessToken).to.equal(accessToken);
        expect(connConfig.apiVersion).to.equal(data.context.apiVersion);
        expect(connConfig.instanceUrl).to.equal(data.context.userContext.salesforceBaseUrl);

        // Ensure accessToken was not serialized
        const dataApiJSON = JSON.stringify(context.org.data);
        expect(dataApiJSON).to.exist;
        expect(dataApiJSON).to.not.contain('accessToken');

        // Validate Connection has expected values
        // TODO: Prevent this, somehow.
        const conn = context.org.data['connect']();
        expect(conn).to.exist;
        // TODO: Prevent access to accessToken
        expect(conn.accessToken).to.equal(accessToken);
        expect(conn.version).to.equal(data.context.apiVersion);
        expect(conn.instanceUrl).to.equal(data.context.userContext.salesforceBaseUrl);
    });

    it('validate context WITHOUT accessToken', () => {
        const data = generateData(false);
        expect(data.context).to.exist;

        const context: Context = getContext(data);
        validateContext(data, context);

        // Requires accessToken
        expect(context.org.data).to.not.exist;
        expect(context.org.unitOfWork).to.not.exist;
        expect(context.org.unitOfWorkGraph).to.not.exist;
        expect(context[FN_INVOCATION]).to.not.exist;
    });

    it('validate API version override', () => {
        const data = generateData(true);
        expect(data.context).to.exist;
        expect(data.context.apiVersion).to.exist;
        data.context.apiVersion = '0.0';

        const context: Context = getContext(data);
        expect(context.org.apiVersion).to.exist;
        expect(context.org.apiVersion).to.equal('0.0');
    });

    it('validate uowGraph with API version override to 50.0', () => {
        const data = generateData(true);

        expect(data.context).to.exist;
        expect(data.context.apiVersion).to.exist;
        data.context.apiVersion = '50.0';

        const context: Context = getContext(data);
        expect(context.org.apiVersion).to.exist;
        expect(context.org.apiVersion).to.equal('50.0');

        // Requires accessToken
        expect(context.org.data).to.exist;
        expect(context.org.unitOfWork).to.exist;
        expect(context.org.unitOfWorkGraph).to.exist;       //apiVersion needs to be at least 50.0
    });

    it('should not create Context.org WITHOUT data.context', () => {
        const context: Context = getContext({"payload":{}});

        expect(context.org).to.not.exist;
        expect(context[FN_INVOCATION]).to.not.exist;
    });

    it('test logger DEBUG level when secret is set', () =>{
        const sname = 'sf-debug';
        const key = 'DEBUG';

        // Stub out the fs calls made by Secrets
        const fsStat = new fs.Stats();
        sandbox.stub(fsStat, 'isDirectory').returns(true);
        sandbox.stub(fsStat, 'isFile').returns(true);

        // Using callsFake here as this repo uses later version of fs.statSync having an API update
        // which now conflicts w/ the SDK's version.
        sandbox.stub(fs, 'statSync').callsFake((path) => {
          if (path === `/platform/services/${sname}/secret` || path === `/platform/services/${sname}/secret/${key}`) {
            return fsStat;
          } else {
            throw new Error('ENOENT');
          }
        });
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        sandbox.stub(fs, <any>'readdirSync')
          .withArgs(`/platform/services/${sname}/secret`)
          .returns([key]);
        sandbox.stub(fs, 'readFileSync')
          .withArgs(`/platform/services/${sname}/secret/${key}`)
          .returns('1');

        const data = generateData(true);
        expect(data.context).to.exist;

        const [cloudEvent, headers] = generateCloudEventObjs(data);
        const logger = new Logger('Evergreen Logger Context Unit Test');
        const mwResult: any = applySfFnMiddleware(cloudEvent, headers, logger);
        validateApplyMiddleWareResult(data, mwResult);

        const context: Context = mwResult[1] as Context;
        validateContext(data, context);

        expect(logger.getLevel() === LoggerLevel.DEBUG).to.be.true;
    });

    it('test logger not DEBUG level when secret not set', () =>{
        const sname = 'sf-debug';
        const key = 'DEBUG';
        sandbox.stub(fs, 'readFileSync')
          .withArgs(`/platform/services/${sname}/secret/${key}`)
          .returns(null);

        const data = generateData(true);
        expect(data.context).to.exist;

        const [cloudEvent, headers] = generateCloudEventObjs(data);
        const logger = new Logger('Evergreen Logger Context Unit Test');
        const mwResult: any = applySfFnMiddleware(cloudEvent, headers, logger);
        validateApplyMiddleWareResult(data, mwResult);

        const context: Context = mwResult[1] as Context;
        validateContext(data, context);

        expect(logger.getLevel() === LoggerLevel.DEBUG).to.be.false;
    });

    it('expect custom payload data not available', () => {
        const data = {"someproperty":"whatever"};
        const [cloudEvent, headers] = generateCloudEventObjs(data);
        const logger = new Logger('Evergreen Logger Context Unit Test');
        const mwResult: any = applySfFnMiddleware(cloudEvent, headers, logger);

        expect(mwResult).to.be.an('array');
        expect(mwResult).to.have.lengthOf(3);
        expect(mwResult[0]).to.exist;
        expect(mwResult[1]).to.exist;
        expect(mwResult[2]).to.exist;

        const event = mwResult[0];
        expect(event.id).to.not.be.undefined;
        expect(event.type).to.not.be.undefined;
        expect(event.source).to.not.be.undefined;
        expect(event.dataContentType).to.not.be.undefined;
        expect(event.dataSchema).to.not.be.undefined;
        expect(event.data).to.be.undefined;
        expect(event.headers).to.not.be.undefined;

        const context: Context = mwResult[1] as Context;
        expect(context.org).to.not.exist;
    });
});
