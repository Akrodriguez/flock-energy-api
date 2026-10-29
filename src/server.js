
import { loadConfig } from './config/env.js';
import { createApp } from './app.js';

const config = loadConfig();
const app = createApp({ config });

app.listen(config.PORT, () => {
  console.log(`Listening on :${config.PORT}`);
});
