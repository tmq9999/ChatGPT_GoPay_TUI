const { v4: uuidv4 } = require('uuid');
const { createClient, buildProxyUrl } = require('./utils/httpClient');
const { fetchOtpWithRetry } = require('./utils/otpFetcher');
const { generateEmail } = require('./utils/emailGenerator');
const { generateSentinelTokens } = require('./utils/sentinelToken');
const logger = require('./utils/logger');

class ChatGPTSignup {
    constructor(a) {
        this.email = a.email;
        this.password = a.password;
        this.name = a.name;
        this.birthdate = a.birthdate;
        this.clientId = a.clientId;
        this.redirectUri = a.redirectUri;
        this.audience = a.audience;
        this.deviceId = uuidv4();
        this.sessionId = uuidv4();
        this.sentinelId = uuidv4();
        this.tag = a.threadId ? '\x1b[96m[#' + a.threadId + ']\x1b[0m ' : '';
        this.otpConfig = {
            provider: a.webmailProvider || 'tempmail',
            serviceDomain: a.emailServiceDomain,
            apiKey: a.emailServiceApiKey,
            tempmailMailboxId: a.tempmailMailboxId || null,
        };
        this.proxyUrl = a.proxyUrl || null;
        this.proxyConfig = a.proxyConfig || null;
        this.signupRetries = a.signupRetries || 3;
        this.sharedCycleTLS = a.sharedCycleTLS || null;
        const { client: b, jar: c } = createClient(this.proxyUrl);
        this.client = b;
        this.jar = c;
        this.csrfToken = null;
        this.authorizeUrl = null;
    }

    _refreshClient() {
        if (this.proxyConfig) {
            const { country: c, user: d, pass: e, host: f, port: g } = this.proxyConfig;
            this.proxyUrl = buildProxyUrl(c, d, e, f, g);
        }
        const { client: a, jar: b } = createClient(this.proxyUrl);
        this.client = a;
        this.jar = b;
    }

    _isCfChallenge(a) {
        const b = a.headers?.['cf-mitigated'];
        if (b === 'challenge') {
            return true;
        }
        const c = typeof a.data === 'string' ? a.data : '';
        return c.includes('cf_chl_opt') || c.includes('challenge-platform') || c.includes('Just a moment') && c.includes('cloudflare');
    }

    async _injectCookies(a) {
        for (const b of a) {
            if (!b.name || !b.value) {
                continue;
            }
            const d = (b.domain || 'chatgpt.com').replace(/^\./, '');
            const e = b.name + '=' + b.value + '; Path=' + (b.path || '/') + (b.secure ? '; Secure' : '');
            try {
                await this.jar.setCookie(e, 'https://' + d + '/');
            } catch (f) {}
        }
    }

    async _runAuthViaBrowser() {
        const { getAuthSession: a } = require('./utils/cfSolver');
        logger.info(this.tag + 'Auth: launching browser...');
        const b = await a(this.proxyUrl, {
            email: this.email,
            deviceId: this.deviceId,
            sessionId: this.sessionId,
        });
        await this._injectCookies(b.cookies);
        this.csrfToken = b.csrfToken;
        logger.info(this.tag + 'Auth via browser \u2713 (' + b.cookies.length + ' cookies)');
    }

    async getCsrfToken() {
        const a = await this.client.get('https://chatgpt.com/api/auth/csrf');
        if (this._isCfChallenge(a)) {
            throw new Error('CF_CHALLENGE_CSRF');
        }
        this.csrfToken = a.data.csrfToken;
        if (!this.csrfToken) {
            throw new Error('CSRF token not found in response');
        }
        logger.info(this.tag + 'CSRF \u2713');
        return this.csrfToken;
    }

    async initiateSignin() {
        const a = new URLSearchParams({
            prompt: 'login',
            'ext-oai-did': this.deviceId,
            auth_session_logging_id: this.sessionId,
            screen_hint: 'login_or_signup',
            login_hint: this.email,
        });
        const b = new URLSearchParams({
            callbackUrl: 'https://chatgpt.com/',
            csrfToken: this.csrfToken,
            json: 'true',
        });
        const c = await this.client.post(
            'https://chatgpt.com/api/auth/signin/openai?' + a.toString(),
            b.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Origin: 'https://chatgpt.com',
                    Referer: 'https://chatgpt.com/',
                },
            }
        );
        if (this._isCfChallenge(c)) {
            throw new Error('CF_CHALLENGE_SIGNIN');
        }
        const d = c.data?.url;
        if (d) {
            this.authorizeUrl = d;
        } else {
            logger.warn(this.tag + 'Signin returned no URL (' + c.status + ') \u2014 using fallback');
            this.authorizeUrl = this._buildAuthorizeUrl();
        }
        logger.info(this.tag + 'Signin \u2713');
        return this.authorizeUrl;
    }

    _buildAuthorizeUrl() {
        const a = new URLSearchParams({
            client_id: this.clientId,
            scope: 'openid email profile offline_access model.request model.read organization.read organization.write',
            response_type: 'code',
            redirect_uri: this.redirectUri,
            audience: this.audience,
            device_id: this.deviceId,
            prompt: 'login',
            'ext-oai-did': this.deviceId,
            auth_session_logging_id: this.sessionId,
            screen_hint: 'login_or_signup',
            login_hint: this.email,
        });
        return 'https://auth.openai.com/api/accounts/authorize?' + a.toString();
    }

    async authorize() {
        const a = await this.client.followRedirects(this.authorizeUrl, {
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                Referer: 'https://chatgpt.com/',
            },
        });
        logger.info(this.tag + 'Auth \u2713');
        return a;
    }

    async register() {
        let a = null;
        try {
            const e = this.client.defaults?.headers?.['User-Agent'] || this.client.defaults?.headers?.common?.['User-Agent'] || '';
            const f = await generateSentinelTokens(this.proxyUrl, e, 'username_password_create', this.sentinelId);
            a = f.sentinelToken;
        } catch (g) {
            logger.debug(this.tag + 'Sentinel gen failed (register): ' + g.message);
        }
        const b = {
            password: this.password,
            username: this.email,
        };
        const c = {
            'Content-Type': 'application/json',
            Origin: 'https://auth.openai.com',
            Referer: 'https://auth.openai.com/create-account/password',
        };
        if (a) {
            c['openai-sentinel-token'] = a;
            logger.debug(this.tag + 'Sentinel token generated (register)');
        }
        const d = await this.client.post('https://auth.openai.com/api/accounts/user/register', b, { headers: c });
        if (d.status === 200) {
            logger.info(this.tag + 'Register \u2713');
        } else if (d.status !== 403) {
            logger.error(this.tag + 'Register failed (' + d.status + ')');
            const h = d.data ? JSON.stringify(d.data).substring(0, 500) : 'no response body';
            logger.error(this.tag + 'Register body: ' + h);
        }
        return d;
    }

    async sendOtp() {
        const a = await this.client.followRedirects('https://auth.openai.com/api/accounts/email-otp/send', {
            headers: {
                Referer: 'https://auth.openai.com/create-account/password',
            },
        });
        logger.info(this.tag + 'OTP sent \u2713');
        return a;
    }

    async validateOtp(a) {
        const b = await this.client.post(
            'https://auth.openai.com/api/accounts/email-otp/validate',
            { code: a.toString() },
            {
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'https://auth.openai.com',
                    Referer: 'https://auth.openai.com/email-verification',
                },
            }
        );
        if (b.status === 200) {
            logger.info(this.tag + 'OTP valid \u2713');
        } else {
            logger.error(this.tag + 'OTP failed (' + b.status + ')');
        }
        return b;
    }

    async createAccount() {
        const a = {
            'Content-Type': 'application/json',
            Origin: 'https://auth.openai.com',
            Referer: 'https://auth.openai.com/about-you',
        };
        const b = await this.client.post(
            'https://auth.openai.com/api/accounts/create_account',
            { name: this.name, birthdate: this.birthdate },
            { headers: a }
        );
        if (b.status === 200) {
            logger.success(this.tag + 'Account created \u2713');
        } else {
            const c = b.data ? JSON.stringify(b.data).substring(0, 200) : 'no response body';
            logger.debug(this.tag + 'Create failed (' + b.status + '): ' + c);
        }
        return b;
    }

    async runSignup() {
        const { runSignupViaAPI: a } = require('./utils/apiSignup');
        const b = this.signupRetries || 10;
        let c = 0;
        for (let d = 0; d < b; d++) {
            if (d > 0) {
                logger.info(this.tag + 'Rotating IP... (retry ' + d + '/' + (b - 1) + ')');
                this._refreshClient();
                this.deviceId = uuidv4();
                this.sessionId = uuidv4();
                await new Promise(k => setTimeout(k, 1000));
            }
            logger.info(this.tag + 'Starting... (attempt ' + (d + 1) + '/' + b + ')');
            let e;
            try {
                e = await a(this.proxyUrl, {
                    email: this.email,
                    password: this.password,
                    name: this.name,
                    birthdate: this.birthdate,
                    deviceId: this.deviceId,
                    sessionId: this.sessionId,
                    sharedCycleTLS: this.sharedCycleTLS,
                    sentinelFn: async (l = 'username_password_create', m, n) => {
                        try {
                            const o = await generateSentinelTokens(this.proxyUrl, '', l, this.sentinelId, n);
                            return o;
                        } catch (p) {
                            logger.info(this.tag + 'Sentinel failed: ' + p.message);
                            return null;
                        }
                    },
                    otpFn: async () => {
                        return await fetchOtpWithRetry(this.email, this.otpConfig, 6, 10000, {
                            skipInitialDelay: false,
                            initialDelay: 10000,
                        });
                    },
                    onStep: l => logger.info('' + this.tag + l),
                });
            } catch (l) {
                const m = l.message?.includes('socket') || l.message?.includes('ECONN') || l.message?.includes('ETIMEDOUT')
                    ? 'Network/proxy error'
                    : l.message;
                logger.warn(this.tag + 'Error: ' + m);
                if (d < b - 1) {
                    continue;
                }
                return { success: false, email: this.email, error: m };
            }
            if (e.success) {
                logger.success(this.tag + 'Account created \u2713');
                return {
                    success: true,
                    email: this.email,
                    password: this.password,
                    name: this.name,
                    accessToken: e.accessToken || null,
                    message: 'Account created successfully!',
                };
            }
            const { step: f, status: g, data: h } = e;
            const i = e.error || '';
            let j = i;
            try {
                const n = typeof h === 'object' ? h : JSON.parse(i);
                j = n?.error?.message || n?.detail || n?.message || i;
            } catch {}
            if (!j) {
                j = h ? JSON.stringify(h).substring(0, 100) : 'unknown';
            }
            if (f === 'init' || f === 'csrf' || f === 'signin' || f === 'register' || f === 'otp_validate') {
                const o = {
                    init: 'Init',
                    csrf: 'CSRF',
                    signin: 'Sign-in',
                    register: 'Register',
                    otp_validate: 'OTP Validate',
                }[f] || f;
                if (f === 'register' && g === 409) {
                    logger.warn('' + this.tag + o + ': email conflict (409) \u2014 retry');
                } else if (f === 'otp_validate') {
                    logger.warn('' + this.tag + o + ': ' + j + ' \u2014 retry');
                } else {
                    logger.warn('' + this.tag + o + ': ' + j + ' \u2014 retry');
                }
                if (d < b - 1) {
                    continue;
                }
            }
            if (f === 'otp') {
                if (c < 1) {
                    c++;
                    const p = this.email.split('@')[1];
                    const { email: q, name: r } = generateEmail(p);
                    logger.warn(this.tag + 'OTP not received \u2014 retry signup with new email: ' + q);
                    this.email = q;
                    this.name = r;
                    this._refreshClient();
                    this.deviceId = uuidv4();
                    this.sessionId = uuidv4();
                    continue;
                }
                logger.error(this.tag + 'OTP not received (after retry)');
                return { success: false, email: this.email, error: 'OTP not received' };
            }
            if (f === 'create_account') {
                const s = h?.error?.code || '';
                if (s === 'unsupported_country') {
                    return {
                        success: false,
                        email: this.email,
                        error: 'Country not supported by OpenAI. Change proxy to another country.',
                    };
                }
                logger.error(this.tag + 'Create account failed (' + g + '): ' + j);
                return {
                    success: false,
                    email: this.email,
                    error: 'Create account failed (' + g + '). Coba ganti domain/run ulang.',
                };
            }
            logger.error('' + this.tag + f + ': ' + j);
            return { success: false, email: this.email, error: j || f + ' failed' };
        }
        return { success: false, email: this.email, error: 'All retries exhausted' };
    }
}

module.exports = ChatGPTSignup;
