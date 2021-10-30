import { rtrimSlashes } from '@joplin/lib/path-utils';
import { Config, DatabaseConfig, DatabaseConfigClient, Env, MailerConfig, RouteType, StripeConfig } from './utils/types';
import * as pathUtils from 'path';
import { loadStripeConfig, StripePublicConfig } from '@joplin/lib/utils/joplinCloud';

interface PackageJson {
	version: string;
}

const packageJson: PackageJson = require(`${__dirname}/packageInfo.js`);

export interface EnvVariables {
	// ==================================================
	// General config
	// ==================================================

	APP_NAME?: string;
	APP_PORT?: string;
	SIGNUP_ENABLED?: string;
	TERMS_ENABLED?: string;
	ACCOUNT_TYPES_ENABLED?: string;
	ERROR_STACK_TRACES?: string;
	COOKIES_SECURE?: string;
	RUNNING_IN_DOCKER?: string;

	// ==================================================
	// URL config
	// ==================================================

	APP_BASE_URL?: string;
	USER_CONTENT_BASE_URL?: string;
	API_BASE_URL?: string;
	JOPLINAPP_BASE_URL?: string;

	// ==================================================
	// Database config
	// ==================================================

	DB_CLIENT?: string;
	DB_SLOW_QUERY_LOG_ENABLED?: string;
	DB_SLOW_QUERY_LOG_MIN_DURATION?: string; // ms
	DB_AUTO_MIGRATION?: string;

	POSTGRES_PASSWORD?: string;
	POSTGRES_DATABASE?: string;
	POSTGRES_USER?: string;
	POSTGRES_HOST?: string;
	POSTGRES_PORT?: string;

	// This must be the full path to the database file
	SQLITE_DATABASE?: string;

	// ==================================================
	// Mailer config
	// ==================================================

	MAILER_ENABLED?: string;
	MAILER_HOST?: string;
	MAILER_PORT?: string;
	MAILER_SECURE?: string;
	MAILER_AUTH_USER?: string;
	MAILER_AUTH_PASSWORD?: string;
	MAILER_NOREPLY_NAME?: string;
	MAILER_NOREPLY_EMAIL?: string;

	SUPPORT_EMAIL?: string;
	SUPPORT_NAME?: string;
	BUSINESS_EMAIL?: string;

	// ==================================================
	// Stripe config
	// ==================================================

	STRIPE_SECRET_KEY?: string;
	STRIPE_WEBHOOK_SECRET?: string;
}

let runningInDocker_: boolean = false;

export function runningInDocker(): boolean {
	return runningInDocker_;
}

function envReadString(s: string, defaultValue: string = ''): string {
	return s === undefined || s === null ? defaultValue : s;
}

function envReadBool(s: string, defaultValue = false): boolean {
	if (s === undefined || s === null) return defaultValue;
	return s === '1';
}

function envReadInt(s: string, defaultValue: number = null): number {
	if (!s) return defaultValue === null ? 0 : defaultValue;
	const output = Number(s);
	if (isNaN(output)) throw new Error(`Invalid number: ${s}`);
	return output;
}

function databaseHostFromEnv(runningInDocker: boolean, env: EnvVariables): string {
	if (env.POSTGRES_HOST) {
		// When running within Docker, the app localhost is different from the
		// host's localhost. To access the latter, Docker defines a special host
		// called "host.docker.internal", so here we swap the values if necessary.
		if (runningInDocker && ['localhost', '127.0.0.1'].includes(env.POSTGRES_HOST)) {
			return 'host.docker.internal';
		} else {
			return env.POSTGRES_HOST;
		}
	}

	return null;
}

function databaseConfigFromEnv(runningInDocker: boolean, env: EnvVariables): DatabaseConfig {
	const baseConfig: DatabaseConfig = {
		client: DatabaseConfigClient.Null,
		name: '',
		slowQueryLogEnabled: envReadBool(env.DB_SLOW_QUERY_LOG_ENABLED),
		slowQueryLogMinDuration: envReadInt(env.DB_SLOW_QUERY_LOG_MIN_DURATION, 10000),
		autoMigration: envReadBool(env.DB_AUTO_MIGRATION, true),
	};

	if (env.DB_CLIENT === 'pg') {
		return {
			...baseConfig,
			client: DatabaseConfigClient.PostgreSQL,
			name: env.POSTGRES_DATABASE || 'joplin',
			user: env.POSTGRES_USER || 'joplin',
			password: env.POSTGRES_PASSWORD || 'joplin',
			port: env.POSTGRES_PORT ? Number(env.POSTGRES_PORT) : 5432,
			host: databaseHostFromEnv(runningInDocker, env) || 'localhost',
		};
	}

	return {
		...baseConfig,
		client: DatabaseConfigClient.SQLite,
		name: env.SQLITE_DATABASE,
		asyncStackTraces: true,
	};
}

function mailerConfigFromEnv(env: EnvVariables): MailerConfig {
	return {
		enabled: env.MAILER_ENABLED !== '0',
		host: env.MAILER_HOST || '',
		port: Number(env.MAILER_PORT || 587),
		secure: !!Number(env.MAILER_SECURE) || true,
		authUser: env.MAILER_AUTH_USER || '',
		authPassword: env.MAILER_AUTH_PASSWORD || '',
		noReplyName: env.MAILER_NOREPLY_NAME || '',
		noReplyEmail: env.MAILER_NOREPLY_EMAIL || '',
	};
}

function stripeConfigFromEnv(publicConfig: StripePublicConfig, env: EnvVariables): StripeConfig {
	return {
		...publicConfig,
		enabled: !!env.STRIPE_SECRET_KEY,
		secretKey: env.STRIPE_SECRET_KEY || '',
		webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
	};
}

function baseUrlFromEnv(env: any, appPort: number): string {
	if (env.APP_BASE_URL) {
		return rtrimSlashes(env.APP_BASE_URL);
	} else {
		return `http://localhost:${appPort}`;
	}
}

let config_: Config = null;

export async function initConfig(envType: Env, env: EnvVariables, overrides: any = null) {
	runningInDocker_ = !!env.RUNNING_IN_DOCKER;

	const rootDir = pathUtils.dirname(__dirname);
	const stripePublicConfig = loadStripeConfig(envType === Env.BuildTypes ? Env.Dev : envType, `${rootDir}/stripeConfig.json`);
	const appName = env.APP_NAME || 'Joplin Server';
	const viewDir = `${rootDir}/src/views`;
	const appPort = env.APP_PORT ? Number(env.APP_PORT) : 22300;
	const baseUrl = baseUrlFromEnv(env, appPort);
	const apiBaseUrl = env.API_BASE_URL ? env.API_BASE_URL : baseUrl;
	const supportEmail = env.SUPPORT_EMAIL || 'SUPPORT_EMAIL'; // Defaults to "SUPPORT_EMAIL" so that server admin knows they have to set it.

	config_ = {
		appVersion: packageJson.version,
		appName,
		isJoplinCloud: apiBaseUrl.includes('.joplincloud.com') || apiBaseUrl.includes('.joplincloud.local'),
		env: envType,
		rootDir: rootDir,
		viewDir: viewDir,
		layoutDir: `${viewDir}/layouts`,
		tempDir: `${rootDir}/temp`,
		logDir: `${rootDir}/logs`,
		database: databaseConfigFromEnv(runningInDocker_, env),
		mailer: mailerConfigFromEnv(env),
		stripe: stripeConfigFromEnv(stripePublicConfig, env),
		port: appPort,
		baseUrl,
		showErrorStackTraces: (env.ERROR_STACK_TRACES === undefined && envType === Env.Dev) || env.ERROR_STACK_TRACES === '1',
		apiBaseUrl,
		userContentBaseUrl: env.USER_CONTENT_BASE_URL ? env.USER_CONTENT_BASE_URL : baseUrl,
		joplinAppBaseUrl: envReadString(env.JOPLINAPP_BASE_URL, 'https://joplinapp.org'),
		signupEnabled: env.SIGNUP_ENABLED === '1',
		termsEnabled: env.TERMS_ENABLED === '1',
		accountTypesEnabled: env.ACCOUNT_TYPES_ENABLED === '1',
		supportEmail,
		supportName: env.SUPPORT_NAME || appName,
		businessEmail: env.BUSINESS_EMAIL || supportEmail,
		cookieSecure: env.COOKIES_SECURE === '1',
		...overrides,
	};
}

export function baseUrl(type: RouteType): string {
	if (type === RouteType.Web) return config().baseUrl;
	if (type === RouteType.Api) return config().apiBaseUrl;
	if (type === RouteType.UserContent) return config().userContentBaseUrl;
	throw new Error(`Unknown type: ${type}`);
}

// User content URL is not supported for now so only show the URL if the
// user content is hosted on the same domain. Needs to get cookie working
// across domains to get user content url working.
export function showItemUrls(config: Config): boolean {
	return config.userContentBaseUrl === config.baseUrl;
}

function config(): Config {
	if (!config_) throw new Error('Config has not been initialized!');
	return config_;
}

export default config;
