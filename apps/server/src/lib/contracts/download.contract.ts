export default {
  post(result: Buffer): true | string {
    return result.length <= 80 * 1024 * 1024 || 'download exceeds ZIP budget';
  },
};
