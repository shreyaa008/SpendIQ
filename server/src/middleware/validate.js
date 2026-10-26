import { z } from 'zod';
import { badRequest } from '../utils/errors.js';

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** validate({ body, query, params }) → results in req.valid.{body,query,params}. Raw req.body/query are never used by handlers. */
export function validate(schemas) {
  return (req, _res, next) => {
    req.valid = req.valid ?? {};
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        throw badRequest('Please fix the highlighted fields.', { details: formatZod(result.error) });
      }
      req.valid[part] = result.data;
    }
    next();
  };
}

export function formatZod(error) {
  const fields = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}