// The job id of the latest download active for each programme (pid). Set when a download is queued and
// cleared when it leaves the queue, so anything logged about that pid in between - queued, complete, failed,
// cancelled - can be tied to the same job. A separate module so the video event service can read it without
// importing the queue (which itself records events).
const jobs = new Map<string, string>();

const activeJobs = {
    set: (pid: string, jobId: string): void => {
        jobs.set(pid, jobId);
    },
    get: (pid: string): string | undefined => jobs.get(pid),
    // With a jobId, only clears when that job is still the recorded one - a programme can have several jobs
    // at once (different resolutions), and one finishing mustn't forget the others.
    clear: (pid: string, jobId?: string): void => {
        if (jobId === undefined || jobs.get(pid) === jobId) {
            jobs.delete(pid);
        }
    },
};

export default activeJobs;
