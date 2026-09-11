import { applyPack, buildPack, decodePack, encodePack, PACK_EXTENSION } from '../lib/kb/transfer';
import { errorText } from '../lib/rag/json';
import type { Collection } from '../lib/types';
import { downloadBlob, plural, slug } from '../lib/utils';
import { toast } from './Toaster';

async function save(pack: Awaited<ReturnType<typeof buildPack>>, filename: string) {
  const bytes = await encodePack(pack);
  downloadBlob(new Blob([bytes], { type: 'application/gzip' }), filename);
}

export async function exportBackup() {
  try {
    const pack = await buildPack({ includeChats: true });
    await save(pack, `captbot-backup-${new Date().toISOString().slice(0, 10)}${PACK_EXTENSION}`);
    toast(`Backup saved: ${plural(pack.documents.length, 'document')} and ${plural(pack.threads.length, 'chat')}.`, 'success');
  } catch (err) {
    toast(`Backup failed: ${errorText(err)}`, 'error');
  }
}

export async function exportCollection(collection: Collection) {
  try {
    const pack = await buildPack({ collectionIds: [collection.id] });
    await save(pack, `${slug(collection.name)}${PACK_EXTENSION}`);
    toast(`Exported “${collection.name}” with ${plural(pack.documents.length, 'document')}.`, 'success');
  } catch (err) {
    toast(`Export failed: ${errorText(err)}`, 'error');
  }
}

export async function importFile(file: File) {
  try {
    const summary = await applyPack(await decodePack(await file.arrayBuffer()));
    const reindex = summary.needsReindex ? ` ${plural(summary.needsReindex, 'document')} need re-indexing.` : '';
    toast(
      `Imported ${plural(summary.documents, 'document')}, ${plural(summary.collections, 'collection')} and ${plural(summary.threads, 'chat')}.${reindex}`,
      'success',
    );
  } catch (err) {
    toast(errorText(err), 'error');
  }
}
