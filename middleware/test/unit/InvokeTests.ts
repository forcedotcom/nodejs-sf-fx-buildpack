/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
import {expect, use} from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import 'mocha';
import * as sinon from 'sinon';
import {Message} from '@projectriff/message';

use(chaiAsPromised);

import {
    generateCloudevent,
    generateData,
} from './FunctionTestUtils';
import {CURRENT_FILENAME, ExtraInfo} from '../../index';

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

describe('Invoke Function Tests', () => {
    const specVersions = ['0.3', '1.0'];
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should invoke the function', async () => {
      const event = {"foo": "bar"};
      const cloudEvent = generateCloudevent(event);
      const fnResult = await require('../../index').default(Message.builder()
          .addHeader('content-type', 'application/json')
          .payload(cloudEvent)
          .build());
      expect(fnResult.payload.event.data.foo).to.equal("bar");
    });

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

    specVersions.forEach(function(specVersion : string) {
        it('should handle invocation - https, specVersion=' + specVersion, async () => {
            const cloudEventRequest = generateCloudevent(generateData(), true, specVersion);
            const fnResult = await require('../../index').default(Message.builder()
                .addHeader('content-type', 'application/json')
                .payload(cloudEventRequest)
                .build());
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

        it('should handle invocation - parse error (before function invocation), specVersion=' + specVersion, async () => {
            const cloudEventRequest = generateCloudevent(generateData(), true, specVersion);
            delete cloudEventRequest['specversion'];
            const fnResult = await require('../../index').default(Message.builder()
                .addHeader('content-type', 'application/json')
                .payload(cloudEventRequest) // not toJSON to cause parse error
                .build());
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

        it('should handle invocation - function error, specVersion=' + specVersion, async () => {
            // Payload signals function to throw an Error
            const cloudEventRequest = generateCloudevent(generateData(true, false, true), true, specVersion);
            const fnResult = await require('../../index').default(Message.builder()
                .addHeader('content-type', 'application/json')
                .payload(cloudEventRequest)
                .build());
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
});
