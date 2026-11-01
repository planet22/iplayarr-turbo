import { ChildProcess } from 'child_process';

export default interface AbstractDownloadService {
    // jobId names the queue entry this download is for - the same programme can be downloading more than
    // once at a time (different resolutions), so the pid alone doesn't say which one.
    download(pid: string, directory: string, jobId?: string): Promise<ChildProcess>;
    postProcess(pid: string, directory: string, code: any, jobId?: string): Promise<void>;
}
