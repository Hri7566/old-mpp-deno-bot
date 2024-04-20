import { Client } from './Client.ts';
import { config as dotEnvConfig } from 'https://deno.land/x/dotenv/mod.ts';

const env = dotEnvConfig();

const MPPCLONE_TOKEN = env.MPPCLONE_TOKEN;

const cl = new Client('wss://mppclone.com:8443', MPPCLONE_TOKEN as string);

class Bot {
    client: Client;

    constructor (cl: Client, chId: string = 'The Dev Channel') {
        this.client = cl;
        this.bindEventListeners(chId);
    }

    start() {
        this.client.start();
    }

    bindEventListeners(chId: string) {
        cl.on('hi', () => {
            cl.setChannel(chId);
        });

        this.client.on('a', msg => {
            console.log(msg.p.name + ':', msg.a);
        });
    }
}

const bot = new Bot(cl, 'The Dev Channel');
bot.start();
