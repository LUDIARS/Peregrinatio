export default {
  post(result: Map<string, Buffer>, _buf: Buffer, limits?: { entryBytes: number; totalBytes: number }): true | string {
    const entryLimit = Math.min(limits?.entryBytes ?? Infinity, 512 * 1024 * 1024);
    const totalLimit = Math.min(limits?.totalBytes ?? Infinity, 1024 * 1024 * 1024);
    let total = 0;
    for (const data of result.values()) {
      if (data.length > entryLimit) return 'entry exceeds expansion budget';
      total += data.length;
    }
    return total <= totalLimit || 'archive exceeds expansion budget';
  },
};
