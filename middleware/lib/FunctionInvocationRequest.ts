
import {Logger} from '@salesforce/core/lib/logger';
import {SObject} from '@salesforce/salesforce-sdk/dist/objects';
import {
    DataApi,
    ErrorResult,
    SuccessResult,
} from '@salesforce/salesforce-sdk/dist/api';

export enum FunctionInvocationRequestStatusEnum {
  Success = 'Success',
  Error = 'Error'
}

// Save update to FunctionInvocationRequest
// Does not throw
export async function saveFnInvocation(logger: Logger,
                                       fnInvocation: FunctionInvocationRequest,
                                       response: any,
                                       status: FunctionInvocationRequestStatusEnum = FunctionInvocationRequestStatusEnum.Success): Promise<void> {
    if (!fnInvocation) {
        return;
    }

    try {
        fnInvocation.status = status;
        fnInvocation.response = response;
        return await fnInvocation.save();
    } catch (err) {
        logger.error(`Unable to save function response [${fnInvocation.id}]: ${err.message}`);
    }
}

export async function saveFnInvocationError(logger: Logger, fnInvocation: FunctionInvocationRequest, response: any): Promise<void> {
    return await saveFnInvocation(logger, fnInvocation, response, FunctionInvocationRequestStatusEnum.Error);
}

// TODO: Remove when FunctionInvocationRequest is deprecated.
export class FunctionInvocationRequest {
    public response: any;
    public status: FunctionInvocationRequestStatusEnum;

    constructor(public readonly id: string,
        private readonly logger: Logger,
        private readonly dataApi?: DataApi) {
    }

    /**
     * Saves FunctionInvocationRequest
     *
     * @throws err if response not provided or on failed save
     */
    public async save(): Promise<any> {
        if (!this.response) {
            throw new Error('Response not provided');
        }

        if (this.dataApi) {
            const responseBase64 = Buffer.from(JSON.stringify(this.response)).toString('base64');

            try {
                // Prime pump (W-6841389)
                const soql = `SELECT Id, FunctionName, Status, CreatedById, CreatedDate FROM FunctionInvocationRequest WHERE Id ='${this.id}'`;
                await this.dataApi.query(soql);
            } catch (err) {
                this.logger.warn(err.message);
            }

            const fnInvocation = new SObject('FunctionInvocationRequest').withId(this.id);
            fnInvocation.setValue('ResponseBody', responseBase64);
            if (this.status) {
                fnInvocation.setValue('Status', this.status.toString());
            }
            const result: SuccessResult | ErrorResult = await this.dataApi.update(fnInvocation);
            if (!result.success && 'errors' in result) {
                // Tells tsc that 'errors' exist and join below is okay
                const msg = `Failed to send response [${this.id}]: ${result.errors.join(',')}`;
                this.logger.error(msg);
                throw new Error(msg);
            } else {
                return result;
            }
        } else {
            throw new Error('Authorization not provided');
        }
    }
}
