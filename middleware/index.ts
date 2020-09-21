/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-explicit-any */
const path = require('path');
import {Logger, LoggerFormat, LoggerLevel} from '@salesforce/core/lib/logger';
import {CloudEvent,Headers as CEHeaders,Receiver} from 'cloudevents';
const {Message} = require('@projectriff/message');
import {applySfFnMiddleware} from './lib/sfMiddleware';
import loadUserFunction from './userFnLoader';
import { Context, InvocationEvent } from '@salesforce/salesforce-sdk';

const FUNCTION_ERROR_CODE = '500';
const INTERNAL_SERVER_ERROR_CODE = '503';
const CURRENT_FILENAME: string = __filename;

export class ExtraInfo {
    constructor(
        public readonly requestId: string,  // incoming x-request-id
        public readonly source: string,     // incoming ce.source
        public readonly execTimeMs: number, // function invocation time
        public stack = ''          // error stack, if applicable
        ) {
        this.stack = encodeURI(this.trim(stack));
    }

    public setStack(stack: string): void {
        this.stack = encodeURI(this.trim(stack));
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

    constructor(public readonly err: Error, public readonly code: string) {
        super(err.message);
        Object.setPrototypeOf(this, new.target.prototype);
        // TODO: Trim stack from this file up
        this.stack = err.stack
    }

    public toString(): string {
        return this.err.toString();
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

function buildErrorResponse(extraInfo: ExtraInfo, err: Error): any {
    // any error in user-function-space should be considered a 500 toerhwi
    // ensure we send down application/json in this case
    extraInfo.setStack(err.stack);
    return buildResponse(err instanceof MiddlewareError ? err.code : INTERNAL_SERVER_ERROR_CODE, err.message, extraInfo);
}

function buildResponse(code: string, response: any, extraInfo: ExtraInfo): any {
    // any error in user-function-space should be considered a 500
    // ensure we send down application/json in this case
    return Message.builder()
        .addHeader('content-type', 'application/json')
        .addHeader('x-http-status', code)
        .addHeader('x-extra-info', JSON.stringify(extraInfo))
        .payload(typeof response === 'string' ? response : JSON.stringify(response))
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
 * Parse input header and body into Cloudevents specification
 */
function parseCloudEvent(logger: Logger, headers: CEHeaders, body: any): CloudEvent {
    const ctype: string = (headers['content-type'] || '').toLowerCase();
    const bodyIsObj: boolean = typeof body === 'object'

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

    // Initialize logger with request ID
    const requestId = headers['ce-id'] || headers['x-request-id'] || bodyPayload['id'];
    const requestLogger = createLogger(requestId);

    // Parse input according to Cloudevents 0.2, 0.3 or 1.0 specification
    let cloudEvent: CloudEvent;
    try {
        cloudEvent = parseCloudEvent(requestLogger, headers, bodyPayload);
    } catch(parseErr) {
        // Only log toplevel input keys since values can contain credentials or PII
        requestLogger.fatal(`Failed to parse CloudEvent content-type=${headers['content-type']} body keys=${Object.keys(bodyPayload)}`);
        requestLogger.fatal(parseErr);
        return buildResponse('400', parseErr.message, parseErr.stack);
    }

    let execTimeMs = -1;
    try {
        let result: any;
        let event: InvocationEvent;
        let context: Context;
        let logger: Logger;
        try {
            // Create function param objects from request
            [event, context, logger] = applySfFnMiddleware(cloudEvent, headers, requestLogger);
        } catch (apiSetupError) {
            throw new MiddlewareError(apiSetupError, INTERNAL_SERVER_ERROR_CODE);
        }

        // Invoke requested function
        const startExecTimeMs = new Date().getTime();
        try {
            result = await userFn(...[event, context, logger]);
        } catch (invokeErr) {
            throw new MiddlewareError(invokeErr, FUNCTION_ERROR_CODE);
        } finally {
            execTimeMs = (new Date().getTime()) - startExecTimeMs;
        }

        // Currently, riff doesn't support undefined or null return values
        return buildResponse('200', result || '', new ExtraInfo(requestId, cloudEvent.source, execTimeMs));

    } catch (error) {
        requestLogger.error(error.toString());
        return buildErrorResponse(new ExtraInfo(requestId, cloudEvent.source, execTimeMs), error);
    }
}

systemFn.$argumentType = 'message';
systemFn.$init = userFn.$init;
systemFn.$destroy = userFn.$destroy;
