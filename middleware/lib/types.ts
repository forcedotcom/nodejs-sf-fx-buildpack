import {Headers} from 'cloudevents';

// keep in sync with https://github.com/forcedotcom/sf-fx-sdk-nodejs
export interface SdkCloudEvent {
    id:               string,
    type:             string,
    data:             JSON,
    source:           string,
    specversion:      string,
    datacontenttype?: string,
    sfcontext?:       any,
    sffncontext?:     any,
    schemaurl?:       string,
    time?:            string,
}

export interface EnrichedFunction { (cloudevent: SdkCloudEvent, headers: Headers): any }
