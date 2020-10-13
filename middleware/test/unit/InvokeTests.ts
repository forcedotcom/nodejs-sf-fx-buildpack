/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
import {expect, use} from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import 'mocha';
import * as sinon from 'sinon';

use(chaiAsPromised);

import {
    generateRequestMessage,
    generateData,
} from './FunctionTestUtils';
import {CURRENT_FILENAME, ExtraInfo} from '../../index';

describe('ExtraInfo', () => {
    it('should parse stack', async () => {
        const extraInfo = new ExtraInfo('requestId', 'source', 1, 220);
        const msg = 'Ooooops';

        extraInfo.setStack(`Error: ${msg}\n    at parseCloudEvent (${CURRENT_FILENAME}:156:7)\n    at Object.systemFn [as default] (${CURRENT_FILENAME}:183:22)\n    at Context.<anonymous> (/home/cwall/git/nodejs-sf-fx-buildpack/middleware/test/unit/InvokeTests.ts:226:66)\n    at callFn (/home/cwall/git/nodejs-sf-fx-buildpack/middleware/node_modules/mocha/lib/runnable.js:372:21)\n    at Test.Runnable.run (/home/cwall/git/nodejs-sf-fx-buildpack/middleware/node_modules/mocha/lib/runnable.js:364:7)\n    at Runner.runTest (/home/cwall/git/nodejs-sf-fx-buildpack/middleware/node_modules/mocha/lib/runner.js:455:10)\n    at /home/cwall/git/nodejs-sf-fx-buildpack/middleware/node_modules/mocha/lib/runner.js:573:12\n    at next (/home/cwall/git/nodejs-sf-fx-buildpack/middleware/node_modules/mocha/lib/runner.js:369:14)`);
        expect(extraInfo.stack).to.not.be.empty;
        const stackParts = extraInfo.stack.split('\n');
        expect(stackParts).to.be.lengthOf(3);
        expect(stackParts[0]).to.be.contain(msg);

        extraInfo.setStack(undefined);
        expect(extraInfo.stack).to.be.lengthOf(0);
    });
})

describe('Invoke Function Tests', () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should invoke the function with the expected payload shape', async () => {
      const event = {"foo": "bar"};
      const fnResult = await require('../../index').default(generateRequestMessage(event));
      expect(fnResult.payload.event.data.foo).to.equal("bar");
    });

    it('should respond successfully', async () => {
        const fnResult = await require('../../index').default(generateRequestMessage(generateData()));
        expect(fnResult).to.be.not.undefined;
        expect(fnResult).to.be.not.null;
        expect(fnResult.headers).to.be.not.null;
        expect(fnResult.headers.getValue('x-http-status')).to.be.equal(200);
        expect(fnResult.headers.getValue('x-extra-info')).to.be.not.null;
        const extraInfoEncoded = fnResult.headers.getValue('x-extra-info');
        expect(extraInfoEncoded).to.contain('%22'); // URI encoded - quote
        expect(extraInfoEncoded).to.contain('%7B'); // URI encoded - open paran
        const extraInfo = JSON.parse(decodeURI(extraInfoEncoded));
        expect(extraInfo.requestId).to.not.be.empty;
        expect(extraInfo.source).to.not.be.empty;
        expect(extraInfo.execTimeMs).to.be.above(0);
        expect(extraInfo.statusCode).to.be.equal(200);
        expect(extraInfo.stack).to.have.lengthOf(0);
        expect(fnResult.payload.success).to.equal(true);
    });

    it('should respond with bad request with invalid cloudevent', async () => {
        const fnResult = await require('../../index').default(generateRequestMessage(generateData(), true));
        expect(fnResult).to.be.not.undefined;
        expect(fnResult).to.be.not.null;
        expect(fnResult.headers.getValue('x-http-status')).to.be.equal(400);
        expect(fnResult.headers.getValue('x-extra-info')).to.be.not.null;
        const extraInfoEncoded = fnResult.headers.getValue('x-extra-info');
        expect(extraInfoEncoded).to.contain('%20'); // URI encoded - space
        expect(extraInfoEncoded).to.contain('%5Cn'); // URI encoded - newline
        const extraInfo = JSON.parse(decodeURI(extraInfoEncoded));
        expect(extraInfo.requestId).to.not.be.empty;
        expect(extraInfo.source).to.not.be.empty;
        expect(extraInfo.execTimeMs).to.be.equal(-1);  // function was not invoked
        expect(extraInfo.statusCode).to.be.equal(400);
        expect(extraInfo.isFunctionError).to.be.false;
        expect(extraInfo.stack).to.not.be.empty;
        expect(decodeURI(extraInfo.stack)).to.contain('Error: ');
    });

    it('should respond with server error with function invocation error', async () => {
        const fnResult = await require('../../index').default(generateRequestMessage(generateData(true)));
        expect(fnResult).to.be.not.undefined;
        expect(fnResult).to.be.not.null;
        expect(fnResult.headers.getValue('x-http-status')).to.be.equal(500);
        expect(fnResult.headers.getValue('x-extra-info')).to.be.not.null;
        const extraInfoEncoded = fnResult.headers.getValue('x-extra-info');
        expect(extraInfoEncoded).to.contain('%20'); // URI encoded - space
        expect(extraInfoEncoded).to.contain('%5Cn'); // URI encoded - newline
        const extraInfo = JSON.parse(decodeURI(extraInfoEncoded));
        expect(extraInfo.requestId).to.not.be.empty;
        expect(extraInfo.source).to.not.be.empty;
        expect(extraInfo.execTimeMs).to.be.above(0);
        expect(extraInfo.statusCode).to.be.equal(500);
        expect(extraInfo.isFunctionError).to.be.true;
        expect(extraInfo.stack).to.not.be.empty;
        expect(extraInfo.stack).to.contain('FakeError');
    });
});
