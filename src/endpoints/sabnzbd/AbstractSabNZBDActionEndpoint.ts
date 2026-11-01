import { NextFunction, Request, Response } from 'express';

import { EndpointDirectory } from '../../constants/EndpointDirectory';

export interface ActionQueryString {
    name?: string
    value?: string
}

export class AbstractSabNZBDActionEndpoint {
    actionDirectory: EndpointDirectory;

    constructor(actionDirectory: EndpointDirectory) {
        this.actionDirectory = actionDirectory;
    }

    handler = async (req: Request, res: Response, next: NextFunction) => {
        const requested = (req.query as ActionQueryString).name;
        const name = requested ?? '_default';
        if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(this.actionDirectory, name)) {
            res.status(400).json({ status: false, error: 'Unknown action' });
            return;
        }
        await this.actionDirectory[name](req, res, next);
    }
}