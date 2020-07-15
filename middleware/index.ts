import {Logger, LoggerLevel} from '@salesforce/core/lib/logger';
import Message = require('@projectriff/message');
import http = require('http');
import https = require('https');
import {applySfFnMiddleware} from './lib/sfMiddleware';
import {
    FunctionInvocationRequest,
    saveFnInvocation,
    saveFnInvocationError
} from './lib/FunctionInvocationRequest';
import {
    ASYNC_CE_TYPE,
    ASYNC_FULFILL_HEADER,
    FN_INVOCATION,
    X_FORWARDED_HOST,
    X_FORWARDED_PROTO
} from './lib/constants';
import loadUserFunction from './userFnLoader';


function createLogger(requestID?: string): Logger {
    const logger = new Logger('Evergreen Logger');
    const level = process.env.DEBUG ? LoggerLevel.DEBUG : LoggerLevel.INFO;

    logger.addStream({stream: process.stderr});
    logger.setLevel(level);

    if (requestID) {
        logger.addField('request_id', requestID);
    }

    return logger;
}

function errorMessage(error: Error): any {  // eslint-disable-line
    // any error in user-function-space should be considered a 500
    // ensure we send down application/json in this case
    return Message.builder()
        .addHeader('content-type', 'application/json')
        .addHeader('x-http-status', '500')
        .payload({
            error: error.toString(),
        })
        .build();
}

function isAsyncRequest(type: string): boolean {
    return type && type.startsWith(ASYNC_CE_TYPE);
}

// Invoke given function again to fulfill async request; response is not handled
// eslint-disable-next-line
async function invokeAsyncFn(logger: Logger, payload: any, headers: any): Promise<void> {
    // host header is required
    const hostKey = Object.keys(headers).find(k => X_FORWARDED_HOST === k.toLowerCase());
    const hostUrl = headers[hostKey];
    if (!hostUrl) {
        throw new Error('Unable to determine host for async invocation');
    }

    const hostParts = hostUrl.split(':');
    const protocolKey = Object.keys(headers).find(k => X_FORWARDED_PROTO === k.toLowerCase());
    let isHttps = true;
    if (headers[protocolKey]) {
        isHttps = headers[protocolKey].toLowerCase() === 'https';
    }

    const options = {
        hostname: hostParts[0],
        port: hostParts[1] ? parseInt(hostParts[1]) : (isHttps ? 443 : 80),
        method: 'POST',
        path: '/',
        headers: {...headers, [ASYNC_FULFILL_HEADER]: true}
    };

    // Invoke function and ignore response
    const lib = isHttps ? https : http;
    return new Promise((resolve, reject) => {
        const expectedErrCode = 'EXPECTED_ECONNRESET';
        const req = lib.request(options);
        req.on('error', async (err) => {
            if (req['destroyed'] && err['code'] === expectedErrCode) {
                // Expected to terminate response
                resolve();
            } else {
                // Return error for async request client
                reject(err);
            }
        });

        // Forward original request
        req.write(JSON.stringify(payload));

        // Flush and finishes sending the request
        req.end(() => {
            logger.info('Forwarded async request');

            // Forget response and destroy the socket
            const expectedErr = new Error();
            expectedErr['code'] = expectedErrCode;
            req.destroy(expectedErr);
        });
    });
}

const userFn = loadUserFunction();

export default async function systemFn(message: any): Promise<any> {  // eslint-disable-line
    const payload = message['payload'];

    // Remap riff headers to a standard JS object
    const headers = message['headers'].toRiffHeaders();
    Object.keys(headers).map((key: string) => {
        headers[key] = message['headers'].getValue(key);
    });

    const requestId = headers['Ce-Id'] || headers['X-Request-Id'];
    const requestLogger = createLogger(requestId);
    let isAsync = false;
    try {
        // If initial async request, invoke function again and release request
        isAsync = isAsyncRequest(payload.type);
        if (isAsync) {
            if (!headers[ASYNC_FULFILL_HEADER]) {
                requestLogger.info('Received initial async request');
                await invokeAsyncFn(requestLogger, payload, headers);
                // Function invoked on forwarded request; release initial client request
                return Message.builder()
                    .addHeader('content-type', 'application/json')
                    .addHeader('x-http-status', '202')
                    .payload('')
                    .build();
            } else {
                requestLogger.info('Fulfilling async request');
            }
        }

        let result: any;  // eslint-disable-line
        let fnInvocation: FunctionInvocationRequest;
        try {
            // Create function param objects from request
            const [event, context, logger] = applySfFnMiddleware({payload, headers}, requestLogger);
            fnInvocation = context[FN_INVOCATION];

            // Invoke requested function
            result = await userFn(...[event, context, logger]);

            // If async, save result to associated function invocation request
            if (isAsync) {
                await saveFnInvocation(requestLogger, fnInvocation, result);
            }

            // Currently, riff doesn't support undefined or null return values
            return result || '';
        } catch (invokeErr) {
            // If async, save error to associated function invocation request
            if (isAsync) {
                await saveFnInvocationError(requestLogger, fnInvocation, invokeErr.message);
            }

            throw invokeErr;
        }
    } catch (error) {
        requestLogger.error(error.toString());
        return errorMessage(error);
    }
}

systemFn.$argumentType = 'message';
systemFn.$init = userFn.$init;
systemFn.$destroy = userFn.$destroy;