/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-explicit-any */
const path = require('path');
import {Logger, LoggerFormat, LoggerLevel} from '@salesforce/core/lib/logger';
import {CloudEvent,Headers as CEHeaders,Receiver} from 'cloudevents';
const {Message} = require('@projectriff/message');
import loadUserFunction from './userFnLoader';

const SUCCESS_CODE = 200;
const FUNCTION_ERROR_CODE = 500;
const INTERNAL_SERVER_ERROR_CODE = 503;
export const CURRENT_FILENAME: string = __filename;

export class ExtraInfo {
    constructor(
        public readonly requestId: string,        // incoming x-request-id
        public readonly source: string,           // incoming ce.source
        public readonly execTimeMs: number,       // function invocation time
        public readonly statusCode: number,       // status code of request
        public readonly isFunctionError = false,  // error in function, if applicable
        public stack = ''                         // error stack, if applicable
        ) {
        this.setStack(stack);
    }

    public setStack(stack: string): void {
        this.stack = this.trim(stack);
    }

    private trim(stack = ''): string {
        if (stack.length === 0) {
            return stack
        }

        // Find index of last desired stack frame
        const pathParts = CURRENT_FILENAME.split(path.sep);
        const stopPoint = pathParts.slice(pathParts.length - 3).join(path.sep);
        const stackParts = stack.split('\n');
        let foundLastIdx = stackParts.length - 1;
        for (; foundLastIdx > 0; foundLastIdx--) {
            if (stackParts[foundLastIdx].includes(stopPoint)) {
                break;
            }
        }

        // Return stack to last desired frame
        return stackParts.slice(0, foundLastIdx + 1).join('\n');
    }
}
class MiddlewareError extends Error {

    public readonly stack: string;

    constructor(public readonly err: Error, public readonly code = INTERNAL_SERVER_ERROR_CODE) {
        super(err.message);
        Object.setPrototypeOf(this, new.target.prototype);
        this.stack = err.stack
    }

    public toString(): string {
        return this.err.toString();
    }
}
class FunctionError extends MiddlewareError {

    constructor(err: Error) {
        super(err, FUNCTION_ERROR_CODE);
    }
}

function createLogger(requestID?: string): Logger {
    const logger = new Logger({
        name: 'Evergreen Logger',
        format: LoggerFormat.LOGFMT,
        stream: process.stderr
    });
    const level = process.env.DEBUG ? LoggerLevel.DEBUG : LoggerLevel.INFO;
    logger.setLevel(level);

    if (requestID) {
        logger.addField('request_id', requestID);
    }

    return logger;
}

function buildResponse(statusCode: number, response: any, extraInfo: ExtraInfo): any {
    // any error in user-function-space should be considered a 500
    // ensure we send down application/json in this case
    return Message.builder()
        .addHeader('content-type', 'application/json')
        .addHeader('x-http-status', statusCode)
        .addHeader('x-extra-info', encodeURI(JSON.stringify(extraInfo)))
        .payload(response)
        .build();
}

/**
 * Take all input headers and convert them to map of lower-case key
 * to input string value.
 *
 * @param message riff Message
 */
function toLowerCaseKeyHeaders(message: any): CEHeaders {
    const hdrs = message['headers'];
    const hmap = {};
    Object.keys(hdrs.toRiffHeaders()).forEach((key) => {
        const lcKey = key.toLowerCase();
        hmap[lcKey] = hdrs.getValue(key);
    });
    return hmap;
}

// Used in parseCloudEvent to relocate 0.2-spec properties to 0.3-spec names
function _mv(obj: any, fromKey: string, toKey: string, newVal: any = undefined): any {
    if (newVal != null) {
        obj[toKey] = newVal;
    } else if (fromKey in obj && obj[fromKey] != null) {
        obj[toKey] = obj[fromKey];
    }
    delete obj[fromKey];
    return obj;
}

/**
 * Decode a "context" CloudEvent attribute that has been encoded to be compliant with the 1.0
 * specification - will arrive as a Base64-encoded-JSON string.
 * @param attrVal CloudEvent attribute value to decode.
 * @returns null on empty attrVal, decoded JS Object if successful.
 */
function decode64(val?: string): JSON {
    if (val != null) {
        const buf = Buffer.from(val, 'base64');
        return JSON.parse(buf.toString());
    }
    return null;
}

/**
 * Parse input header and body into Cloudevents specification
 */
function parseCloudEvent(logger: Logger, headers: CEHeaders, body: any): CloudEvent {
    const ctype: string = (headers['content-type'] || '').toLowerCase();
    const bodyIsObj: boolean = typeof body === 'object';

    // Core API 48.0 and below send an 0.2-format CloudEvent that needs to be reformatted
    if (bodyIsObj &&
            'specVersion' in body &&
            '0.2' === body['specVersion']) {
        _mv(body, 'specVersion', 'specversion', '0.3');
        _mv(body, 'contentType', 'datacontenttype');
        _mv(body, 'schemaURL', 'schemaurl');
        headers['content-type'] = 'application/cloudevents+json';
        logger.info('Translated cloudevent 0.2 to 0.3 format');

        // Initial deployment of Core API 50.0 send the wrong content-type, need to adjust
    } else if (ctype.includes('application/json') &&
            bodyIsObj &&
            'specversion' in body) {
        headers['content-type'] = 'application/cloudevents+json';
        logger.info('Forced content-type to: application/cloudevents+json');
    }

    const isSpec1 = parseInt(body.specversion?.split('.')?.[0] || 0) >= 1;
    if (isSpec1 && body?.sfcontext) {
      body['sfcontext'] = decode64(body.sfcontext);
    } else if (body.data?.context) {
      body['sfcontext'] = body.data.context;
    }

    if (isSpec1 && body?.sffncontext) {
      body['sffncontext'] = decode64(body.sffncontext);
    } else if (body.data?.sfContext) {
      body['sffncontext'] = body.data.sfContext;
    }

    if (body?.data?.context && body?.data?.sfContext && body?.data?.payload) {
      body.data = body.data?.payload;
    }

    // make a clone of the body if object - cloudevents sdk deletes keys as it parses.
    // otherwise Receiver will do a JSON parse so need to re-stringify any string body
    const bodyShallowCopy = bodyIsObj ? Object.assign({}, body) :
            JSON.stringify(body);
    return Receiver.accept(headers, bodyShallowCopy);
}


const userFn = loadUserFunction(process.env['SF_FUNCTION_PACKAGE_NAME']);

export default async function systemFn(message: any): Promise<any> {
    // Remap riff headers to a standard JS object with lower-case keys
    const headers = toLowerCaseKeyHeaders(message);

    // evergreen:function:invoke includes an extra 'data' level for BinaryHTTP format
    let bodyPayload: any = message['payload'];
    if (typeof bodyPayload === 'object' &&
            'data' in bodyPayload &&
            'ce-id' in headers &&
            headers['ce-specversion'] === '0.3') {
        bodyPayload = bodyPayload['data'];
    }

    // Determine request ID
    const requestId = headers['ce-id'] || headers['x-request-id'] || bodyPayload['id'];

    // Handle health check calls identified by x-health-check request header
    if ('x-health-check' in headers && headers['x-health-check'] === "true") {
        return buildResponse(SUCCESS_CODE, "OK", new ExtraInfo(requestId, "x-health-check", 1, SUCCESS_CODE))
    }

    // Initialize logger with request ID
    const requestLogger = createLogger(requestId);

    let execTimeMs = -1;
    let cloudEvent: CloudEvent;
    try {
        // Parse input according to Cloudevents 0.2, 0.3 or 1.0 specification
        try {
            cloudEvent = parseCloudEvent(requestLogger, headers, bodyPayload);
        } catch(parseErr) {
            // Only log toplevel input keys since values can contain credentials or PII
            requestLogger.fatal(`Failed to parse CloudEvent content-type=${headers['content-type']} body keys=${Object.keys(bodyPayload)}`);
            requestLogger.fatal(parseErr);
            throw new MiddlewareError(parseErr, 400);
        }

        // Invoke requested function
        let result: any;
        const startExecTimeMs = new Date().getTime();
        try {
            result = await userFn(cloudEvent.toJSON(), headers);
        } catch (invokeErr) {
            throw new FunctionError(invokeErr);
        } finally {
            execTimeMs = (new Date().getTime()) - startExecTimeMs;
        }

        // Currently, riff doesn't support undefined or null return values
        return buildResponse(SUCCESS_CODE, result || '', new ExtraInfo(requestId, cloudEvent.source, execTimeMs, SUCCESS_CODE));

    } catch (error) {
        requestLogger.error(error.toString());
        const extraInfo = new ExtraInfo(
            requestId,
            cloudEvent ? cloudEvent.source : 'n/a',
            execTimeMs,
            error instanceof MiddlewareError ? error.code : INTERNAL_SERVER_ERROR_CODE,
            error instanceof FunctionError,
            error.stack);
        return buildResponse(extraInfo.statusCode, error.message, extraInfo);
    }
}

systemFn.$argumentType = 'message';
systemFn.$init = userFn.$init;
systemFn.$destroy = userFn.$destroy;
