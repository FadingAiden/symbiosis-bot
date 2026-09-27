//----------------------------------------------------------
// SYMBIOSIS DISCORD BOT
//
// FEATURES
//
// /verify
// /sync
// /setrole
//
// Roblox ↔ Discord verification
//
// Automatic:
// • Verified
// • Creator
// • Supporter
// • Early Supporter
// • Top Supporter
//
// Shared/manual DataStore:
// • Moderator
// • Community Staff
// • Contributor
// • Bug Hunter
// • VETERAN
// • Tester
//----------------------------------------------------------


require("dotenv").config();


const crypto =
	require("crypto");


const express =
	require("express");


const Database =
	require("better-sqlite3");


const {
	Client,
	GatewayIntentBits,
	SlashCommandBuilder,
	PermissionFlagsBits,
} =
	require("discord.js");


//----------------------------------------------------------
// CONFIG
//----------------------------------------------------------

const DISCORD_TOKEN =
	process.env.DISCORD_TOKEN;


const GUILD_ID =
	process.env.DISCORD_GUILD_ID;


const OWNER_DISCORD_ID =
	process.env.OWNER_DISCORD_ID;


const UNIVERSE_ID =
	process.env.ROBLOX_UNIVERSE_ID;


const ROBLOX_API_KEY =
	process.env.ROBLOX_OPEN_CLOUD_KEY;


const CREATOR_ROBLOX_ID =
	String(
		process.env.CREATOR_ROBLOX_ID
		|| ""
	);


const SHARED_SECRET =
	process.env.ROBLOX_SHARED_SECRET;


const PORT =
	Number(
		process.env.PORT
		|| 3000
	);


//----------------------------------------------------------
// DATASTORE NAMES
//----------------------------------------------------------

const DONATION_STORE =
	"SymbiosisDonationData_v1";


const PROFILE_ROLE_STORE =
	"SymbiosisProfileRoles_v1";


const DONATION_LEADERBOARD =
	"SymbiosisDonations_v1";


const SUPPORTER_THRESHOLD =
	200;


//----------------------------------------------------------
// DISCORD ROLE IDS
//----------------------------------------------------------

const ROLE_IDS = {

	Creator:
		process.env.ROLE_CREATOR,

	Moderator:
		process.env.ROLE_MODERATOR,

	CommunityStaff:
		process.env.ROLE_COMMUNITY_STAFF,

	TopSupporter:
		process.env.ROLE_TOP_SUPPORTER,

	Contributor:
		process.env.ROLE_CONTRIBUTOR,

	BugHunter:
		process.env.ROLE_BUG_HUNTER,

	EarlySupporter:
		process.env.ROLE_EARLY_SUPPORTER,

	VETERAN:
		process.env.ROLE_VETERAN,

	Tester:
		process.env.ROLE_TESTER,

	Supporter:
		process.env.ROLE_SUPPORTER,

	Verified:
		process.env.ROLE_VERIFIED,

};


//----------------------------------------------------------
// VALIDATE IMPORTANT SETTINGS
//----------------------------------------------------------

const requiredSettings = {

	DISCORD_TOKEN,
	GUILD_ID,
	UNIVERSE_ID,
	ROBLOX_API_KEY,
	SHARED_SECRET,

};


for (
	const [name, value]
	of Object.entries(requiredSettings)
) {

	if (!value) {

		throw new Error(
			`Missing environment variable: ${name}`
		);

	}

}


//----------------------------------------------------------
// DATABASE
//----------------------------------------------------------

const database =
	new Database(
		"symbiosis.sqlite"
	);


database.pragma(
	"journal_mode = WAL"
);


database.exec(`

	CREATE TABLE IF NOT EXISTS account_links (

		discord_id TEXT PRIMARY KEY,
		roblox_id TEXT UNIQUE NOT NULL,
		roblox_username TEXT,
		verified_at INTEGER NOT NULL

	);


	CREATE TABLE IF NOT EXISTS verification_codes (

		code TEXT PRIMARY KEY,
		discord_id TEXT NOT NULL,
		expires_at INTEGER NOT NULL

	);

`);


//----------------------------------------------------------
// DISCORD CLIENT
//----------------------------------------------------------

const client =
	new Client({

		intents: [

			GatewayIntentBits.Guilds,

			GatewayIntentBits.GuildMembers,

		],

	});


//----------------------------------------------------------
// ROBLOX OPEN CLOUD
//----------------------------------------------------------

const ROBLOX_CLOUD_BASE =
	"https://apis.roblox.com/cloud/v2";


//----------------------------------------------------------
// ROBLOX REQUEST
//----------------------------------------------------------

async function robloxRequest(
	url,
	options = {}
) {

	const response =
		await fetch(
			url,
			{

				...options,

				headers: {

					"x-api-key":
						ROBLOX_API_KEY,

					"Content-Type":
						"application/json",

					...options.headers,

				},

			}
		);


	return response;

}


//----------------------------------------------------------
// GET NORMAL DATASTORE ENTRY
//----------------------------------------------------------

async function getDataStoreEntry(
	storeName,
	entryId
) {

	const url =

		`${ROBLOX_CLOUD_BASE}`
		+ `/universes/${encodeURIComponent(UNIVERSE_ID)}`
		+ `/data-stores/${encodeURIComponent(storeName)}`
		+ `/entries/${encodeURIComponent(String(entryId))}`;


	const response =
		await robloxRequest(
			url
		);


	if (response.status === 404) {

		return null;

	}


	if (!response.ok) {

		const text =
			await response.text();


		throw new Error(
			`Roblox DataStore GET failed (${response.status}): ${text}`
		);

	}


	const body =
		await response.json();


	return body.value
		?? body;

}


//----------------------------------------------------------
// CREATE / UPDATE NORMAL DATASTORE ENTRY
//----------------------------------------------------------

async function setDataStoreEntry(
	storeName,
	entryId,
	value
) {

	const existing =
		await getDataStoreEntry(
			storeName,
			entryId
		);


	//------------------------------------------------------
	// CREATE
	//------------------------------------------------------

	if (existing === null) {

		const base =

			`${ROBLOX_CLOUD_BASE}`
			+ `/universes/${encodeURIComponent(UNIVERSE_ID)}`
			+ `/data-stores/${encodeURIComponent(storeName)}`
			+ `/entries`;


		const url =
			new URL(base);


		url.searchParams.set(
			"id",
			String(entryId)
		);


		const response =
			await robloxRequest(
				url,
				{

					method:
						"POST",

					body:
						JSON.stringify({

							value,

						}),

				}
			);


		if (!response.ok) {

			const text =
				await response.text();


			throw new Error(
				`Roblox DataStore CREATE failed (${response.status}): ${text}`
			);

		}


		return;

	}


	//------------------------------------------------------
	// UPDATE
	//------------------------------------------------------

	const url =

		`${ROBLOX_CLOUD_BASE}`
		+ `/universes/${encodeURIComponent(UNIVERSE_ID)}`
		+ `/data-stores/${encodeURIComponent(storeName)}`
		+ `/entries/${encodeURIComponent(String(entryId))}`;


	const response =
		await robloxRequest(
			url,
			{

				method:
					"PATCH",

				body:
					JSON.stringify({

						value,

					}),

			}
		);


	if (!response.ok) {

		const text =
			await response.text();


		throw new Error(
			`Roblox DataStore UPDATE failed (${response.status}): ${text}`
		);

	}

}


//----------------------------------------------------------
// TOP SUPPORTERS
//----------------------------------------------------------

let topSupporterIds =
	new Set();


async function refreshTopSupporters() {

	const base =

		`${ROBLOX_CLOUD_BASE}`
		+ `/universes/${encodeURIComponent(UNIVERSE_ID)}`
		+ `/ordered-data-stores/${encodeURIComponent(DONATION_LEADERBOARD)}`
		+ `/scopes/global/entries`;


	const url =
		new URL(base);


	url.searchParams.set(
		"orderBy",
		"value desc"
	);


	url.searchParams.set(
		"maxPageSize",
		"10"
	);


	const response =
		await robloxRequest(
			url
		);


	if (!response.ok) {

		const text =
			await response.text();


		throw new Error(
			`Top supporter lookup failed (${response.status}): ${text}`
		);

	}


	const body =
		await response.json();


	//------------------------------------------------------
	// Handle current/future response naming gracefully.
	//------------------------------------------------------

	const entries =

		body.orderedDataStoreEntries

		|| body.dataStoreEntries

		|| body.entries

		|| [];


	const newTop =
		new Set();


	for (const entry of entries) {

		const amount =
			Number(
				entry.value
				?.value

				?? entry.value

				?? 0
			);


		let id =

			entry.id

			|| entry.entryId

			|| null;


		//--------------------------------------------------
		// Some responses expose the ID at the end of path.
		//--------------------------------------------------

		if (
			!id
			&& typeof entry.path === "string"
		) {

			const pieces =
				entry.path.split("/");


			id =
				pieces[
					pieces.length - 1
				];

		}


		if (
			id
			&& amount >= SUPPORTER_THRESHOLD
		) {

			newTop.add(
				String(id)
			);

		}

	}


	topSupporterIds =
		newTop;


	console.log(
		"[TOP SUPPORTERS]",
		[...topSupporterIds]
	);

}


//----------------------------------------------------------
// FIND LINK
//----------------------------------------------------------

function getLinkByDiscord(
	discordId
) {

	return database
		.prepare(`
			SELECT *
			FROM account_links
			WHERE discord_id = ?
		`)
		.get(
			String(discordId)
		);

}


function getLinkByRoblox(
	robloxId
) {

	return database
		.prepare(`
			SELECT *
			FROM account_links
			WHERE roblox_id = ?
		`)
		.get(
			String(robloxId)
		);

}


//----------------------------------------------------------
// CALCULATE DESIRED ROLES
//----------------------------------------------------------

async function calculateDesiredRoles(
	robloxId
) {

	robloxId =
		String(
			robloxId
		);


	const desired =
		new Set();


	//------------------------------------------------------
	// VERIFIED
	//------------------------------------------------------

	desired.add(
		"Verified"
	);


	//------------------------------------------------------
	// CREATOR
	//------------------------------------------------------

	if (
		robloxId
		=== CREATOR_ROBLOX_ID
	) {

		desired.add(
			"Creator"
		);

	}


	//------------------------------------------------------
	// MANUAL / COMMUNITY ROLES
	//------------------------------------------------------

	let manualRoles =
		null;


	try {

		manualRoles =
			await getDataStoreEntry(
				PROFILE_ROLE_STORE,
				robloxId
			);

	}
	catch (error) {

		console.error(
			"[ROLES] Manual-role lookup failed:",
			error.message
		);

	}


	if (
		manualRoles
		&& typeof manualRoles === "object"
	) {

		if (manualRoles.Moderator === true) {

			desired.add(
				"Moderator"
			);

		}


		if (manualRoles.CommunityStaff === true) {

			desired.add(
				"CommunityStaff"
			);

		}


		if (manualRoles.Contributor === true) {

			desired.add(
				"Contributor"
			);

		}


		if (manualRoles.BugHunter === true) {

			desired.add(
				"BugHunter"
			);

		}


		if (manualRoles.VETERAN === true) {

			desired.add(
				"VETERAN"
			);

		}


		if (manualRoles.Tester === true) {

			desired.add(
				"Tester"
			);

		}

	}


	//------------------------------------------------------
	// DONATION DATA
	//------------------------------------------------------

	let donationData =
		null;


	try {

		donationData =
			await getDataStoreEntry(
				DONATION_STORE,
				robloxId
			);

	}
	catch (error) {

		console.error(
			"[ROLES] Donation lookup failed:",
			error.message
		);

	}


	if (
		donationData
		&& typeof donationData === "object"
	) {

		const total =
			Number(
				donationData.Total
				|| 0
			);


		//----------------------------------------------
		// SUPPORTER
		//----------------------------------------------

		if (
			total
			>= SUPPORTER_THRESHOLD
		) {

			desired.add(
				"Supporter"
			);

		}


		//----------------------------------------------
		// EARLY SUPPORTER
		//----------------------------------------------

		if (
			donationData.EarlySupporter
			=== true
		) {

			desired.add(
				"EarlySupporter"
			);

		}

	}


	//------------------------------------------------------
	// CURRENT TOP 10
	//------------------------------------------------------

	if (
		topSupporterIds.has(
			robloxId
		)
	) {

		desired.add(
			"TopSupporter"
		);

	}


	return desired;

}


//----------------------------------------------------------
// SYNC ONE DISCORD MEMBER
//----------------------------------------------------------

async function syncMember(
	member,
	robloxId
) {

	const desired =
		await calculateDesiredRoles(
			robloxId
		);


	const addIds =
		[];


	const removeIds =
		[];


	for (
		const [roleName, roleId]
		of Object.entries(ROLE_IDS)
	) {

		if (!roleId) {

			continue;

		}


		const role =
			member.guild.roles.cache.get(
				roleId
			);


		if (!role) {

			console.warn(
				`[DISCORD] Role missing: ${roleName} (${roleId})`
			);

			continue;

		}


		if (!role.editable) {

			console.warn(
				`[DISCORD] Bot cannot manage role: ${roleName}`
			);

			continue;

		}


		const hasRole =
			member.roles.cache.has(
				roleId
			);


		const shouldHave =
			desired.has(
				roleName
			);


		if (
			shouldHave
			&& !hasRole
		) {

			addIds.push(
				roleId
			);

		}


		if (
			!shouldHave
			&& hasRole
		) {

			removeIds.push(
				roleId
			);

		}

	}


	//------------------------------------------------------
	// APPLY
	//------------------------------------------------------

	if (addIds.length > 0) {

		await member.roles.add(
			addIds,
			"SYMBIOSIS Roblox role synchronization"
		);

	}


	if (removeIds.length > 0) {

		await member.roles.remove(
			removeIds,
			"SYMBIOSIS Roblox role synchronization"
		);

	}


	console.log(
		"[SYNC]",
		member.user.tag,
		"Roblox:",
		robloxId,
		"Roles:",
		[...desired].join(", ")
	);


	return desired;

}


//----------------------------------------------------------
// SYNC EVERY LINKED ACCOUNT
//----------------------------------------------------------

async function syncAllLinked() {

	const guild =
		await client.guilds.fetch(
			GUILD_ID
		);


	await guild.roles.fetch();


	const links =
		database
			.prepare(`
				SELECT *
				FROM account_links
			`)
			.all();


	console.log(
		"[SYNC] Synchronizing",
		links.length,
		"linked accounts."
	);


	for (const link of links) {

		try {

			const member =
				await guild.members.fetch(
					link.discord_id
				);


			await syncMember(
				member,
				link.roblox_id
			);

		}
		catch (error) {

			console.error(
				"[SYNC] Failed:",
				link.discord_id,
				error.message
			);

		}


		//--------------------------------------------------
		// Small delay to be gentle with Discord.
		//--------------------------------------------------

		await new Promise(
			resolve =>
				setTimeout(
					resolve,
					250
				)
		);

	}

}


//----------------------------------------------------------
// VERIFICATION CODE
//----------------------------------------------------------

function createVerificationCode() {

	return crypto
		.randomBytes(5)
		.toString("hex")
		.toUpperCase();

}


//----------------------------------------------------------
// SLASH COMMANDS
//----------------------------------------------------------

const verifyCommand =
	new SlashCommandBuilder()
		.setName("verify")
		.setDescription(
			"Link your Discord account to your Roblox account."
		);


const syncCommand =
	new SlashCommandBuilder()
		.setName("sync")
		.setDescription(
			"Refresh your SYMBIOSIS Discord roles."
		);


const setRoleCommand =
	new SlashCommandBuilder()
		.setName("setrole")
		.setDescription(
			"Assign a SYMBIOSIS profile role."
		)

		.addUserOption(
			option =>

				option
					.setName("member")
					.setDescription(
						"Verified Discord member"
					)
					.setRequired(true)
		)

		.addStringOption(
			option =>

				option
					.setName("role")
					.setDescription(
						"SYMBIOSIS role"
					)
					.setRequired(true)

					.addChoices(

						{
							name: "Moderator",
							value: "Moderator",
						},

						{
							name: "Community Staff",
							value: "CommunityStaff",
						},

						{
							name: "Contributor",
							value: "Contributor",
						},

						{
							name: "Bug Hunter",
							value: "BugHunter",
						},

						{
							name: "VETERAN",
							value: "VETERAN",
						},

						{
							name: "Tester",
							value: "Tester",
						},

					)
		)

		.addBooleanOption(
			option =>

				option
					.setName("enabled")
					.setDescription(
						"Give or remove the role"
					)
					.setRequired(true)
		)

		.setDefaultMemberPermissions(
			PermissionFlagsBits.ManageGuild
		);


//----------------------------------------------------------
// COMMAND HANDLING
//----------------------------------------------------------

client.on(
	"interactionCreate",

	async interaction => {

		if (
			!interaction.isChatInputCommand()
		) {

			return;

		}


		//--------------------------------------------------
		// /VERIFY
		//--------------------------------------------------

		if (
			interaction.commandName
			=== "verify"
		) {

			const existing =
				getLinkByDiscord(
					interaction.user.id
				);


			if (existing) {

				await interaction.reply({

					content:

						`You are already linked to Roblox UserId `
						+ `**${existing.roblox_id}**.\n\n`
						+ `Use **/sync** to refresh your roles.`,

					ephemeral:
						true,

				});


				return;

			}


			//----------------------------------------------
			// Delete previous unused code.
			//----------------------------------------------

			database
				.prepare(`
					DELETE FROM verification_codes
					WHERE discord_id = ?
				`)
				.run(
					interaction.user.id
				);


			let code;


			do {

				code =
					createVerificationCode();

			}
			while (
				database
					.prepare(`
						SELECT code
						FROM verification_codes
						WHERE code = ?
					`)
					.get(code)
			);


			const expiresAt =
				Date.now()
				+ (10 * 60 * 1000);


			database
				.prepare(`
					INSERT INTO verification_codes
					(code, discord_id, expires_at)
					VALUES (?, ?, ?)
				`)
				.run(

					code,

					interaction.user.id,

					expiresAt

				);


			await interaction.reply({

				content:

					"## SYMBIOSIS Verification\n\n"
					+ "Your one-time code is:\n\n"
					+ `**${code}**\n\n`
					+ "Enter this code in the **Discord Verification** menu inside SYMBIOSIS.\n\n"
					+ "The code expires in **10 minutes**.\n"
					+ "Never send this code to another person.",

				ephemeral:
					true,

			});


			return;

		}


		//--------------------------------------------------
		// /SYNC
		//--------------------------------------------------

		if (
			interaction.commandName
			=== "sync"
		) {

			const link =
				getLinkByDiscord(
					interaction.user.id
				);


			if (!link) {

				await interaction.reply({

					content:
						"You are not verified yet. Use **/verify** first.",

					ephemeral:
						true,

				});


				return;

			}


			await interaction.deferReply({

				ephemeral:
					true,

			});


			try {

				await refreshTopSupporters();


				const desired =
					await syncMember(
						interaction.member,
						link.roblox_id
					);


				await interaction.editReply(

					"Your SYMBIOSIS roles have been synchronized.\n\n"
					+ `**${[...desired].join(", ")}**`

				);

			}
			catch (error) {

				console.error(error);


				await interaction.editReply(
					"Role synchronization failed. Please try again later."
				);

			}


			return;

		}


		//--------------------------------------------------
		// /SETROLE
		//--------------------------------------------------

		if (
			interaction.commandName
			=== "setrole"
		) {

			//----------------------------------------------
			// Extra owner protection.
			//----------------------------------------------

			if (
				interaction.user.id
				!== OWNER_DISCORD_ID
			) {

				await interaction.reply({

					content:
						"Only the SYMBIOSIS owner can use this command.",

					ephemeral:
						true,

				});


				return;

			}


			const discordUser =
				interaction.options.getUser(
					"member",
					true
				);


			const roleName =
				interaction.options.getString(
					"role",
					true
				);


			const enabled =
				interaction.options.getBoolean(
					"enabled",
					true
				);


			const link =
				getLinkByDiscord(
					discordUser.id
				);


			if (!link) {

				await interaction.reply({

					content:
						"That Discord account has not verified a Roblox account yet.",

					ephemeral:
						true,

				});


				return;

			}


			await interaction.deferReply({

				ephemeral:
					true,

			});


			try {

				const oldData =

					await getDataStoreEntry(
						PROFILE_ROLE_STORE,
						link.roblox_id
					)

					|| {};


				oldData[roleName] =
					enabled;


				await setDataStoreEntry(

					PROFILE_ROLE_STORE,

					link.roblox_id,

					oldData

				);


				const member =
					await interaction.guild.members.fetch(
						discordUser.id
					);


				await syncMember(
					member,
					link.roblox_id
				);


				await interaction.editReply(

					`${enabled ? "Assigned" : "Removed"} `
					+ `**${roleName}** `
					+ `${enabled ? "to" : "from"} `
					+ `**${discordUser.username}**.`

				);

			}
			catch (error) {

				console.error(error);


				await interaction.editReply(
					"Role update failed. Check the bot console."
				);

			}

		}

	}
);


//----------------------------------------------------------
// BOT READY
//----------------------------------------------------------

client.once(
	"ready",

	async () => {

		console.log(
			`[DISCORD] Logged in as ${client.user.tag}`
		);


		const guild =
			await client.guilds.fetch(
				GUILD_ID
			);


		await guild.roles.fetch();


		//--------------------------------------------------
		// GUILD COMMANDS
		//
		// Guild commands update almost immediately,
		// making them convenient during development.
		//--------------------------------------------------

		await guild.commands.set([

			verifyCommand.toJSON(),

			syncCommand.toJSON(),

			setRoleCommand.toJSON(),

		]);


		console.log(
			"[DISCORD] Commands registered."
		);


		try {

			await refreshTopSupporters();

			await syncAllLinked();

		}
		catch (error) {

			console.error(
				"[STARTUP SYNC]",
				error
			);

		}


		//--------------------------------------------------
		// PERIODIC RECONCILIATION
		//--------------------------------------------------

		setInterval(

			async () => {

				try {

					await refreshTopSupporters();

					await syncAllLinked();

				}
				catch (error) {

					console.error(
						"[PERIODIC SYNC]",
						error
					);

				}

			},

			10 * 60 * 1000

		);

	}
);


//----------------------------------------------------------
// WEB API
//----------------------------------------------------------

const app =
	express();


app.use(
	express.json({

		limit:
			"16kb",

	})
);


//----------------------------------------------------------
// HEALTH
//----------------------------------------------------------

app.get(
	"/health",

	(request, response) => {

		response.json({

			ok:
				true,

			service:
				"SYMBIOSIS Discord",

		});

	}
);


//----------------------------------------------------------
// ROBLOX REDEEMS VERIFICATION CODE
//----------------------------------------------------------

app.post(
	"/roblox/redeem",

	async (
		request,
		response
	) => {

		try {

			//----------------------------------------------
			// AUTHENTICATE ROBLOX SERVER
			//----------------------------------------------

			const suppliedSecret =
				request.headers[
					"x-symbiosis-secret"
				];


			if (
				typeof suppliedSecret
					!== "string"

				|| suppliedSecret
					!== SHARED_SECRET
			) {

				response
					.status(401)
					.json({

						ok:
							false,

						message:
							"Unauthorized",

					});


				return;

			}


			//----------------------------------------------
			// BODY
			//----------------------------------------------

			const code =
				String(
					request.body.code
					|| ""
				)
					.trim()
					.toUpperCase();


			const robloxId =
				String(
					request.body.robloxUserId
					|| ""
				);


			const robloxUsername =
				String(
					request.body.robloxUsername
					|| ""
				);


			if (
				!code
				|| !/^\d+$/.test(robloxId)
			) {

				response
					.status(400)
					.json({

						ok:
							false,

						message:
							"Invalid verification request.",

					});


				return;

			}


			//----------------------------------------------
			// CODE LOOKUP
			//----------------------------------------------

			const verification =
				database
					.prepare(`
						SELECT *
						FROM verification_codes
						WHERE code = ?
					`)
					.get(
						code
					);


			if (!verification) {

				response
					.status(400)
					.json({

						ok:
							false,

						message:
							"Verification code is invalid.",

					});


				return;

			}


			if (
				verification.expires_at
				< Date.now()
			) {

				database
					.prepare(`
						DELETE FROM verification_codes
						WHERE code = ?
					`)
					.run(
						code
					);


				response
					.status(400)
					.json({

						ok:
							false,

						message:
							"Verification code expired.",

					});


				return;

			}


			//----------------------------------------------
			// STOP ONE ROBLOX ACCOUNT LINKING TO MULTIPLE
			// DISCORD USERS.
			//----------------------------------------------

			const existingRobloxLink =
				getLinkByRoblox(
					robloxId
				);


			if (
				existingRobloxLink
				&& existingRobloxLink.discord_id
					!== verification.discord_id
			) {

				response
					.status(409)
					.json({

						ok:
							false,

						message:
							"This Roblox account is already linked.",

					});


				return;

			}


			//----------------------------------------------
			// ENSURE DISCORD MEMBER EXISTS
			//----------------------------------------------

			const guild =
				await client.guilds.fetch(
					GUILD_ID
				);


			const member =
				await guild.members.fetch(
					verification.discord_id
				);


			//----------------------------------------------
			// SAVE LINK
			//----------------------------------------------

			database
				.prepare(`
					INSERT INTO account_links
					(
						discord_id,
						roblox_id,
						roblox_username,
						verified_at
					)

					VALUES (?, ?, ?, ?)

					ON CONFLICT(discord_id)
					DO UPDATE SET

						roblox_id =
							excluded.roblox_id,

						roblox_username =
							excluded.roblox_username,

						verified_at =
							excluded.verified_at
				`)
				.run(

					verification.discord_id,

					robloxId,

					robloxUsername,

					Date.now()

				);


			//----------------------------------------------
			// ONE USE ONLY
			//----------------------------------------------

			database
				.prepare(`
					DELETE FROM verification_codes
					WHERE code = ?
				`)
				.run(
					code
				);


			//----------------------------------------------
			// SYNC ROLES IMMEDIATELY
			//----------------------------------------------

			await refreshTopSupporters();


			const desired =
				await syncMember(
					member,
					robloxId
				);


			response.json({

				ok:
					true,

				message:
					"Discord account verified.",

				roles:
					[...desired],

			});


			console.log(
				"[VERIFY]",
				member.user.tag,
				"↔",
				robloxUsername,
				robloxId
			);

		}
		catch (error) {

			console.error(
				"[VERIFY API]",
				error
			);


			response
				.status(500)
				.json({

					ok:
						false,

					message:
						"Verification service error.",

				});

		}

	}
);


//----------------------------------------------------------
// START WEB SERVER
//----------------------------------------------------------

app.listen(
	PORT,

	() => {

		console.log(
			`[WEB] Listening on port ${PORT}`
		);

	}
);


//----------------------------------------------------------
// LOGIN
//----------------------------------------------------------

client.login(
	DISCORD_TOKEN
);
