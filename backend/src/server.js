const { createApp } = require('./app');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

const app = createApp();

app.listen(port, host, () => {
    console.log(`IELTS Practice backend listening at http://${host}:${port}/`);
});
