/**
 * Describe Ever-func here.
 *
 * The exported method is the entry point for your code when the function is invoked.
 *
 * Following parameters are pre-configured and provided to your function on execution:
 * @param event:   represents the data associated with the occurrence of an event, and
 *                 supporting metadata about the source of that occurrence.
 * @param context: represents the connection to Evergreen and your Salesforce org.
 * @param logger:  logging handler used to capture application logs and traces specific
 *                 to a given execution of a function.
 */
module.exports = async function (event, context, logger) {
    if (event.data && event.data.shouldThrowError) {
        throw new Error('FakeError');
    }

    await new Promise(r => setTimeout(r, 1000));

    return {'success': true};
}