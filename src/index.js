import serverlessExpress from "@vendia/serverless-express";
import { handler as internalHandler } from "HANDLER";
import polka from "polka";

const app = polka().use(internalHandler);

// @ts-ignore-error
export const handler = serverlessExpress({ app });
