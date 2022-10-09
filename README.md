# sveltekit-adapter-lambda

Adapter for SvelteKit applications that generates a handler for use on AWS Lambda. Just build, zip, and upload.

This adapter is largely based on [@sveltejs/adapter-node](https://github.com/sveltejs/kit/tree/master/packages/adapter-node), but the handler it produces is based on [@vendia/serverless-express](https://github.com/vendia/serverless-express).

## Usage

Install with `npm i -D @tessellator/sveltekit-adapter-lambda`, then add the following to your `svelte.config.js`:

```js
// svelte.config.js
import adapter from "@tessellator/sveltekit-adapter-lambda";

export default {
  kit: {
    adapter: adapter(),
  },
};
```

## Environment Variables

Supports the following env vars from [@sveltejs/adapter-node](https://www.npmjs.com/package/@sveltejs/adapter-node):

- ORIGIN
- PROTOCOL_HEADER
- HOST_HEADER
- ADDRESS_HEADER
- XFF_DEPTH
- BODY_SIZE_LIMIT

Note that a maximum value of 6MB for `BODY_SIZE_LIMIT` is enforced because it is an AWS Lambda limit.

## Options

All options from [@sveltejs/adapter-node](https://www.npmjs.com/package/@sveltejs/adapter-node) are supported.

## Deploying

You will need the output directory (`build` by default), the project's `package.json`, and the production dependencies in `node_modules` to run the application. Production dependencies can be generated with `npm ci --prod` (you can skip this step if your app doesn't have any dependencies). You can then zip these files and upload them to your Lambda function.

Development dependencies will be bundled into your app using `esbuild`. To control whether a given package is bundled or externalised, place it in `devDependencies` or `dependencies` respectively in your `package.json`.

## License

[MIT](./LICENSE)
