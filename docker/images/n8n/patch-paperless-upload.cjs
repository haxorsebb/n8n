// Adapt the pinned @iamfj community upload operation for upload-only service identities.
// Keep task polling and failure handling; avoid GET /api/documents/{id}/ on success.
const fs = require('node:fs');
const file = '/opt/n8n-paperless-nodes/node_modules/@iamfj/n8n-nodes-paperless-ngx/dist/contexts/ingestion/presentation/upload.execute.js';
const source = fs.readFileSync(file, 'utf8');
const before = `    const document = await client.request({
        method: 'GET',
        path: \`/api/documents/\${task.documentId}/\`,
    });
    return [{ json: { ...document, taskId }, pairedItem: { item: itemIndex } }];`;
const after = '    return [{ json: { taskId, status: task.status, documentId: task.documentId }, pairedItem: { item: itemIndex } }];';
if (source.split(before).length !== 2) {
    throw new Error('Pinned Paperless upload implementation changed; review patch before building');
}
fs.writeFileSync(file, source.replace(before, after));
