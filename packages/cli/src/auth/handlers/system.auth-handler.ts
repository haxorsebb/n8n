import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import {
	AuthIdentity,
	AuthIdentityRepository,
	GLOBAL_ADMIN_ROLE,
	GLOBAL_MEMBER_ROLE,
	GLOBAL_OWNER_ROLE,
	User,
	UserRepository,
} from '@n8n/db';
import type { IPasswordAuthHandler } from '@n8n/decorators';
import { AuthHandler } from '@n8n/decorators';
import { Constructable } from '@n8n/di';

import {
	getCurrentAuthenticationMethod,
	setCurrentAuthenticationMethod,
} from '@/sso.ee/sso-helpers';

const execFileAsync = promisify(execFile);

@AuthHandler()
export class SystemAuthHandler implements IPasswordAuthHandler<User> {
	readonly metadata = { name: 'system', type: 'password' as const };
	readonly userClass: Constructable<User> = User;

	private readonly enabled = process.env.N8N_SYSTEM_AUTH_ENABLED === 'true';
	private readonly pamService = process.env.N8N_SYSTEM_AUTH_PAM_SERVICE ?? 'n8n';
	private readonly userGroup = process.env.N8N_SYSTEM_AUTH_USER_GROUP ?? 'n8n-users';
	private readonly adminGroup = process.env.N8N_SYSTEM_AUTH_ADMIN_GROUP ?? 'n8n-admins';
	private readonly ownerUsername = process.env.N8N_SYSTEM_AUTH_OWNER_USERNAME ?? 'admin';

	constructor(
		private readonly userRepository: UserRepository,
		private readonly authIdentityRepository: AuthIdentityRepository,
	) {}

	async init() {
		if (!this.enabled) return;

		if (getCurrentAuthenticationMethod() !== 'system') {
			await setCurrentAuthenticationMethod('system');
		}
	}

	private async authenticatePam(username: string, password: string): Promise<boolean> {
		return await new Promise<boolean>((resolve) => {
			const child = spawn(
				'pamtester',
				[this.pamService, username, 'authenticate', 'acct_mgmt'],
				{ stdio: ['pipe', 'ignore', 'ignore'] },
			);

			let settled = false;
			const finish = (result: boolean) => {
				if (settled) return;
				settled = true;
				resolve(result);
			};

			child.once('error', () => finish(false));
			child.once('close', (code) => finish(code === 0));
			child.stdin.end(`${password}\n`);
		});
	}

	private async getSystemGroups(username: string): Promise<Set<string> | undefined> {
		try {
			const { stdout } = await execFileAsync('id', ['-nG', username], {
				encoding: 'utf8',
			});
			return new Set(stdout.trim().split(/\s+/).filter(Boolean));
		} catch {
			return undefined;
		}
	}

	private async findBySystemIdentity(username: string): Promise<User | undefined> {
		const identity = await this.authIdentityRepository.findOne({
			where: { providerId: username, providerType: 'system' },
			relations: ['user', 'user.role', 'user.authIdentities'],
		});

		return identity?.user;
	}

	private async bindOwner(username: string): Promise<User | undefined> {
		const owner = await this.userRepository.findOne({
			where: { role: { slug: GLOBAL_OWNER_ROLE.slug } },
			relations: ['role', 'authIdentities'],
		});
		if (!owner || owner.disabled) return undefined;

		await this.authIdentityRepository.save(AuthIdentity.create(owner, username, 'system'));

		return (
			(await this.userRepository.findOne({
				where: { id: owner.id },
				relations: ['role', 'authIdentities'],
			})) ?? undefined
		);
	}

	private async createSystemUser(username: string, isAdmin: boolean): Promise<User | undefined> {
		const role = isAdmin ? GLOBAL_ADMIN_ROLE : GLOBAL_MEMBER_ROLE;
		const { user } = await this.userRepository.createUserWithProject({
			email: null,
			password: null,
			role: { slug: role.slug },
		});

		await this.authIdentityRepository.save(AuthIdentity.create(user, username, 'system'));

		return (
			(await this.userRepository.findOne({
				where: { id: user.id },
				relations: ['role', 'authIdentities'],
			})) ?? undefined
		);
	}

	private async syncRole(user: User, isAdmin: boolean): Promise<User> {
		if (user.role.slug === GLOBAL_OWNER_ROLE.slug) return user;

		const targetRole = isAdmin ? GLOBAL_ADMIN_ROLE : GLOBAL_MEMBER_ROLE;
		if (user.role.slug !== targetRole.slug) {
			user.role = targetRole;
			await this.userRepository.save(user, { transaction: true });
		}

		return user;
	}

	async handleLogin(username: string, password: string): Promise<User | undefined> {
		if (!this.enabled || !username || !password) return undefined;

		const groups = await this.getSystemGroups(username);
		if (!groups) return undefined;

		const isOwner = username === this.ownerUsername;
		const isAdmin = groups.has(this.adminGroup);
		const isUser = groups.has(this.userGroup);
		if (!isOwner && !isAdmin && !isUser) return undefined;

		if (!(await this.authenticatePam(username, password))) return undefined;

		const existing = await this.findBySystemIdentity(username);
		if (existing) {
			if (existing.disabled) return undefined;
			if (isOwner && existing.role.slug !== GLOBAL_OWNER_ROLE.slug) return undefined;
			return await this.syncRole(existing, isAdmin);
		}

		if (isOwner) return await this.bindOwner(username);

		return await this.createSystemUser(username, isAdmin);
	}
}
