/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-explicit-any */
const path = require('path');
import {Logger, LoggerFormat, LoggerLevel} from '@salesforce/core/lib/logger';
import {CloudEvent,Headers as CEHeaders,Receiver} from 'cloudevents';
const {Message} = require('@projectriff/message');
import loadUserFunction from './userFnLoader';
import {SdkCloudEvent} from './lib/types';

const SUCCESS_CODE = 200;
const FUNCTION_ERROR_CODE = 500;
const INTERNAL_SERVER_ERROR_CODE = 503;
export const CURRENT_FILENAME: string = __filename;

const toSdkCloudEvent = (cloudevent: CloudEvent) : SdkCloudEvent => {
    return {
        id: cloudevent.id,
        type: cloudevent.type,
        source: cloudevent.source,
        specversion: cloudevent.specversion,
        datacontenttype: cloudevent.datacontenttype,
        schemaurl: cloudevent.schemaurl,
        time: new Date(cloudevent.time as string).toISOString(),
        data: !(cloudevent.data instanceof Uint32Array) ? <any>cloudevent.data : undefined,
        sfcontext: cloudevent.sfcontext,
        sffncontext: cloudevent.sffncontext,
    }
}

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
function parseCloudEvent(headers: CEHeaders, body: any): CloudEvent {
    const bodyIsObj: boolean = typeof body === 'object';

    // make a clone of the body if object - cloudevents sdk deletes keys as it parses.
    // otherwise Receiver will do a JSON parse so need to re-stringify any string body
    const bodyShallowCopy = bodyIsObj ? Object.assign({}, body) :
            JSON.stringify(body);

    const result = Receiver.accept(headers, bodyShallowCopy);

    // turn the base 64 encoded string values into objects for the sdk contract
    return result.cloneWith({
        sfcontext: decode64(result.sfcontext as string),
        sffncontext: decode64(result.sffncontext as string)
    })
}


const userFn = loadUserFunction(process.env['SF_FUNCTION_PACKAGE_NAME'])

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
            cloudEvent = parseCloudEvent(headers, bodyPayload);
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
            result = await userFn(toSdkCloudEvent(cloudEvent), headers);
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
systemFn.$init = (<any>userFn).$init;
systemFn.$destroy = (<any>userFn).$destroy;
