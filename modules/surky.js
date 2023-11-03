//Setup for non-AT users
if (typeof MODULES === 'undefined') {
	MODULES = {};
}

if (typeof $$ !== 'function') {
	$$ = function (a) {
		return document.querySelector(a);
	}
	$$$ = function (a) {
		return [].slice.apply(document.querySelectorAll(a));
	};
}

function legalizeInput(settingID) {

	if (!settingID) return;
	settingID = document.getElementById(settingID);
	var defaultValue = settingID.placeholder;
	var minValue = settingID.min;
	var maxValue = settingID.max;
	var val = 0;

	val = parseFloat(settingID.value);
	var badNum = isNaN(val);
	if (badNum)
		val = defaultValue;
	if (minValue !== null && val < minValue)
		settingID.value = minValue;
	else if (maxValue !== null && val > maxValue)
		settingID.value = maxValue;
	else
		settingID.value = val;
}

MODULES.surky = {};
MODULES.surky.perks = {};
MODULES.surky.props = {};

function runSurky() {
	if (portalUniverse !== 2) return;
	initialLoad();
	getPerkEfficiencies();
	if (!game.global.canRespecPerks)
		autobuyPerks();
	else
		clearAndAutobuyPerks();
}

function allocateSurky() {
	if (portalUniverse !== 2) return;
	//Can't respec perks when running Hypothermia so don't try as it causes errors
	if (challengeActive('Hypothermia')) return;
	const perks = {};
	for (var [key, value] of Object.entries(MODULES.surky.perks)) {
		if (typeof (value) !== "object" || !value.hasOwnProperty("optimize")) continue;
		perks[key] = value.level;
	}
	const perkString = LZString.compressToBase64(JSON.stringify(perks));

	tooltip('Import Perks', null, 'update');
	document.getElementById('perkImportBox').value = perkString;
	importPerks();
	cancelTooltip();
}

function initPresetSurky() {
	var settingInputs = JSON.parse(localStorage.getItem('surkyInputs'));

	//Initial setup if we don't already have a save file setup
	if (settingInputs === null) {
		settingInputs = {};
		return settingInputs;
	};

	function presetData(preset) {
		if (settingInputs === null) return null;
		if (settingInputs[preset] === null || settingInputs[preset] === undefined) return null;
		return settingInputs[preset];
	}

	const presetNames = [].slice.apply(document.querySelectorAll('#preset > *'));
	const presets = {};
	for (var item in presetNames) {
		item = presetNames[item].value;
		if (item.includes('— ')) continue;
		presets[item] = presetData(item);
	}

	return {
		clearWeight: +$$('#clearWeight').value,
		survivalWeight: +$$('#survivalWeight').value,
		radonWeight: +$$('#radonWeight').value,
		...presets,
	}
}

function saveSurkySettings() {
	const saveData = initPresetSurky();
	//Initial setup and saving preset value
	const settingInputs = { preset: $$('#preset').value, }
	//Saving the values of the inputs for the weights
	for (var item in MODULES.autoPerks.GUI.inputs) {
		item = MODULES.autoPerks.GUI.inputs[item];
		settingInputs[item] = +$$('#' + item).value;
	}
	//Save inputs for all the presets that users can select.
	//Overrides data for current preset otherwises saves any already saved data for the others.
	const presetNames = [].slice.apply(document.querySelectorAll('#preset > *'));
	for (var item in presetNames) {
		item = presetNames[item].value;
		if (item.includes('— ')) continue;
		if (settingInputs.preset === item)
			settingInputs[item] = [settingInputs['clearWeight'], settingInputs['survivalWeight'], settingInputs['radonWeight']];
		else
			settingInputs[item] = saveData[item];
	}

	localStorage.setItem('surkyInputs', JSON.stringify(settingInputs));
	if (typeof (autoTrimpSettings) !== 'undefined' && typeof (autoTrimpSettings.ATversion) !== 'undefined' && !autoTrimpSettings.ATversion.includes('SadAugust')) {
		autoTrimpSettings['autoAllocatePresets'].value = JSON.stringify(settingInputs);
		saveSettings();
	}
}

// fill preset weights from the dropdown menu and set special challenge
function fillPresetSurky(specificPreset) {
	if (specificPreset) $$('#preset').value = specificPreset;

	const defaultWeights = {
		ezfarm: [0, 0, 1],
		tufarm: [1, 0.5, 15],
		push: [1, 1, 0],
		alchemy: [1, 0.01, 10],
		trappa: [1, 1.5, 0],
		downsize: [1, 1, 0],
		duel: [1, 0.2, 0],
		berserk: [1, 0.5, 0],
		smithless: [1, 0.5, 0],
		combat: [1, 0.1, 0],
		combatRadon: [1, 0.5, 15],
		equip: [1, 0, 0],
		resminus: [1, 0, 0],
		resplus: [1, 0, 0],
		trappacarp: [1, 0, 0],

	}
	const localData = initPresetSurky();
	const preset = $$('#preset').value;
	const weights = (localData[preset] === null || localData[preset] === undefined) ? defaultWeights[preset] : localData[preset];
	$$('#clearWeight').value = weights[0];
	$$('#survivalWeight').value = weights[1];
	$$('#radonWeight').value = weights[2];
	saveSurkySettings();

	$$('#radonPerRunDiv').style.display = 'none';
	$$('#findPotsDiv').style.display = preset === 'alchemy' ? 'inline' : 'none';
	$$('#trapHrsDiv').style.display = preset === 'trappa' ? 'inline' : 'none';
}

// Quick and dirty hack: estimate about 60% Rn from VMs for VS1.
// exponentially weighted moving average parameters for Rn/run
MODULES.surky.rnMAWeights = new Array(10);
MODULES.surky.rnMAWeights[0] = 0.3;
MODULES.surky.rnMAWeightsum = 0.3;
for (var i = 1; i < 10; i++) {
	MODULES.surky.rnMAWeights[i] = MODULES.surky.rnMAWeights[i - 1] * 0.7;
	MODULES.surky.rnMAWeightsum += MODULES.surky.rnMAWeights[i];
}
// correct weights to sum to 1 with limited # of terms
for (var i = 0; i < 10; i++) {
	MODULES.surky.rnMAWeights[i] /= MODULES.surky.rnMAWeightsum;
}

// initialize perks object to default values
function initPerks() {
	MODULES.surky.props = {
		radonSpent: 0,
		// radon spent on perks so far
		radonPerRun: 0,
		// radon per farming run (needed to value trinket gains)
		radonPerTrinket: 0,
		// the Rn-equivalent value of a marginal trinket
		trinketRadonPerRun: 0,
		// baseline total radon value of expected trinkets gained per run at current perks
		baselineTrinketsNext: 0,
		// end of next run expected trinket count at current Observation
		//shieldCC: 0, // TONOTDO: strictly, this matters. sort of. if it's <100% it affects the value of criticality. also in Duel. but we can ignore this for a start.
		shieldCD: 0,
		shieldPrismal: 0,
		healthDerate: 1,
		// inequality makes raw health boosts less useful, so we derate health weight by this factor (based on inequality from equipped shield)
		tributes: 0,
		imperzone: 0,
		housingCount: 0,
		hubEnabled: game.global.exterminateDone,
		meteorologists: 0,
		tenacityTime: 10,
		// minutes of tenacity to optimize for (hardcoded to 10mins - this is not relevant for long and the input box added clutter and resulted in a lot of questions)
		coordLimited: 0,
		// 0-1 value of "how coord limited" we are
		trapHrs: 5,
		// hours of trapping
		shinyTable: [0],
		// memoization table for trinket drops
		clearWeight: Number($$('#clearWeight').value),
		survivalWeight: Number($$('#survivalWeight').value),
		radonWeight: Number($$('#radonWeight').value),

		scruffyLevel: 0,
		weaponLevels: 1,
		armorLevels: 1,
		coefC: 0,
		// tauntimp correction parameter
		termR: 0,
		// tauntimp correction parameter
		gbAfterpush: false,
		// is GB used in the afterpush?
		glassRadon: false,
		// ...and does it get us more radon for more pushing power? (i.e. can we increase our VM zone within the current challenge)
		specialChallenge: null,
		// does the dropdown specify a special challenge?
		trappaStartPop: 1,
		// avoid NaNs before calculating perks
		potency: 0.0085,
		// breed speed base
		carpNeeded: 0,
		// carp levels needed to afford all coords at target zone (based on current save)
	};

	const preset = $$('#preset').value;

	MODULES.surky.perks = {
		Agility: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 4,
			priceFact: 1.3,
			max: 20,
		},
		Artisanistry: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 15,
			priceFact: 1.3,
			effect: 1 / 0.95,
			efficiency: 0,
		},
		Bait: {
			optimize: preset === 'trappa',
			locked: true,
			level: 0,
			priceBase: 4,
			priceFact: 1.3,
		},
		Carpentry: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 25,
			priceFact: 1.3,
			effect: 1.1,
			efficiency: 0,
		},
		Criticality: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 100,
			priceFact: 1.3,
			effect: 0.1,
			efficiency: 0,
		},
		Equality: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 1,
			priceFact: 1.5,
			effect: 1 / 0.9,
			efficiency: 0,
		},
		Championism: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 1e9,
			priceFact: 5,
			effect: 0,
			// defined on save-load based on SA progress
			efficiency: 0,
		},
		Frenzy: {
			optimize: preset !== 'berserk',
			locked: true,
			level: 0,
			priceBase: 1000000000000000,
			priceFact: 1.3,
			effect: 0.5,
			procEffect: 0.001,
			timeEffect: 5,
			efficiency: 0,
		},
		Greed: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 10000000000,
			priceFact: 1.3,
			effect: 0,
			// based on tributes
			max: 40,
			efficiency: 0,
		},
		Hunger: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 1000000,
			priceFact: 1.3,
			max: 30,
		},
		Looting: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 1,
			priceFact: 1.3,
			effect: 0.05,
			efficiency: 0,
		},
		Motivation: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 2,
			priceFact: 1.3,
			effect: 0.05,
			efficiency: 0,
		},
		Observation: {
			optimize: true,
			locked: true,
			canDisable: true,
			level: 0,
			priceBase: 5e18,
			priceFact: 2,
			max: 50,
			efficiency: 0,
			efficiency2: 0,
			// we check for buying 2 obs levels as this may be super-extra-efficient for the extra guaranteed Rt drops
		},
		Packrat: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 3,
			priceFact: 1.3,
			effect: 0.2,
			efficiency: 0,
		},
		Pheromones: {
			optimize: preset !== 'trappa' && game.stats.highestRadLevel.valueTotal() >= 60,
			locked: true,
			level: 0,
			priceBase: 3,
			priceFact: 1.3,
			effect: 0.1,
			efficiency: 0,
		},
		Power: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 1,
			priceFact: 1.3,
			effect: 0.05,
			efficiency: 0,
		},
		Prismal: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 1,
			priceFact: 1.3,
			effect: 0.01,
			max: 100,
			efficiency: 0,
		},
		Range: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 1,
			priceFact: 1.3,
			max: 10,
		},
		Resilience: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 100,
			priceFact: 1.3,
			effect: 1.1,
			efficiency: 0,
		},
		Masterfulness: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 100e21,
			priceFact: 50,
			max: 10,
			effect: 1,
			efficiency: 0,
		},
		Tenacity: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 50000000,
			priceFact: 1.3,
			effect: 0,
			// based on tenacityTime
			max: 40,
			efficiency: 0,
		},
		Toughness: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 1,
			priceFact: 1.3,
			effect: 0.05,
			efficiency: 0,
		},
		Trumps: {
			optimize: preset === 'downsize',
			locked: true,
			level: 0,
			priceBase: 3,
			priceFact: 1.3,
		},
		Smithology: {
			optimize: preset !== 'smithless',
			locked: true,
			level: 0,
			priceBase: 100e21,
			priceFact: 4,
			effect: 1,
			efficiency: 0,
		},
		Expansion: {
			optimize: true,
			locked: true,
			level: 0,
			priceBase: 100e21,
			priceFact: 3,
			effect: 1,
			efficiency: 0,
		},
	};

	if (preset === 'combat' || preset === 'combatRadon') {
		if (challengeActive('Trappapalooza')) {
			MODULES.surky.perks.Bait.optimize = false;
			MODULES.surky.perks.Pheromones.optimize = false;
		}
	}
}

function initialLoad(skipLevel) {

	initPerks();
	var portal = game.portal;

	// read save into input perk fields
	// enable perks (in input fields and perks object) based on locked status from save
	// DO NOT update perk object levels yet
	for (var [key, value] of Object.entries(MODULES.surky.perks)) {
		if (typeof (value) !== "object" || !value.hasOwnProperty("optimize"))
			continue;
		// iterating over the perks, ignoring aux values
		if (portal.hasOwnProperty(key)) {
			var portalPerk = portal[key];
			var calcPerk = MODULES.surky.perks[key];
			if (!skipLevel) calcPerk.level = portalPerk.radLevel + portalPerk.levelTemp
			calcPerk.locked = portalPerk.radLocked;
		} else {
			MODULES.surky.perks[key].level = 0;
		}
	}

	var preset = $$('#preset').value;
	MODULES.surky.props.specialChallenge = preset;

	// "red" fields should only be overwritten if loading a U2 save (values will be garbage in U1) -- Surky is gonna break if portal Universe isn't set to 2 here!
	var surkyInputs = JSON.parse(localStorage.getItem("surkyInputs"));

	// target zone to CLEAR is 1 zone before the portal zone by default
	var currentZone = Math.max(1, game.global.universe === 2 ? game.global.world : surkyInputs.targetZone);
	$$('#targetZone').value = Math.max(currentZone, surkyInputs.targetZone);
	MODULES.surky.props.targetZone = Number($$('#targetZone').value);

	// weapon/armor levels taken from dagger/boots (most likely to be leveled highest)
	$$('#weaponLevels').value = surkyInputs.weaponLevels;
	MODULES.surky.props.weaponLevels = Number($$('#weaponLevels').value);

	$$('#armorLevels').value = surkyInputs.armorLevels;
	MODULES.surky.props.armorLevels = Number($$('#armorLevels').value);

	// get current purchased tributes, mets, etc
	var tributeCount = (game.buildings.Tribute.owned || 0);
	$$('#tributes').value = Math.max(tributeCount, surkyInputs.tributes);
	MODULES.surky.props.tributes = Number($$('#tributes').value);

	var metCount = (game.jobs.Meteorologist.owned || 0);
	$$('#meteorologists').value = Math.max(metCount, surkyInputs.meteorologists);
	MODULES.surky.props.meteorologists = Number($$('#meteorologists').value);

	var smithyCount = (game.buildings.Smithy.owned || 0);
	$$('#smithyCount').value = Math.max(smithyCount, surkyInputs.smithyCount);
	MODULES.surky.props.smithyCount = Number($$('#smithyCount').value);

	var rnPerRun = (game.resources.radon.owned || 0);
	MODULES.surky.props.radonPerRun = Math.max(rnPerRun, Number(surkyInputs.radonPerRun));
	$$('#radonPerRun').value = MODULES.surky.props.radonPerRun;

	// get count of best housing building (don't bother optimizing lower than gateways, the 2nd-order adjustments won't matter enough to bother)
	var housingCount = (game.buildings.Collector.owned || 0);
	$$('#housingCount').value = Math.max(housingCount, surkyInputs.housingCount)
	MODULES.surky.props.housingCount = Number($$('#housingCount').value);

	//Figure out hours trapped for Trappapalooza. Default is 5!
	$$('#trapHrs').value = surkyInputs.trapHrs;
	MODULES.surky.props.trapHrs = Number($$('#trapHrs').value);

	$$('#findPots').value = Math.max(alchObj.potionsOwned[2], surkyInputs.findPots);

	MODULES.surky.props.vmZone = Math.max(15, (MODULES.surky.props.targetZone - 1));
	var rawRnRun = game.resources.radon.owned;
	MODULES.surky.props.radonPerRun = Number($$('#radonPerRun').value);

	// if Rn/run is locked, believe it, and force the old history (lets the user manually correct an error)
	// also for easier testing (and to prevent long term problems with bad user input), assume an input greater than lifetime radon is not something the user wants semi-permanently locked 
	if (rawRnRun > parseFloat(MODULES.surky.props.radonPerRun) / 20 || MODULES.surky.props.radonPerRun >= game.global.totalRadonEarned && rawRnRun > game.global.totalRadonEarned / 1e6) {
		var history = new Array(MODULES.surky.rnTerms);
		// maintain a history of the last 10 farming runs' Rn gain, and evaluate an exponentially weighted moving average over this history
		if (window.localStorage.getItem('rPrHistory')) {
			history = JSON.parse(window.localStorage.getItem('rPrHistory'));
		}
		for (var i = MODULES.surky.rnTerms - 1; i >= 0; i--) {
			// any uninitialized value just gets the current Rn/run (should only happen once per user's localStorage)
			if (!(history[i] > 0))
				history[i] = rawRnRun;
		}
		for (var i = MODULES.surky.rnTerms - 1; i > 0; i--) {
			history[i] = history[i - 1];
			// shift all history entries one run older
		}
		history[0] = rawRnRun;
		var ewma = 0;
		for (var i = 0; i < MODULES.surky.rnTerms; i++) {
			ewma += history[i] * MODULES.surky.rnMAWeights[i];
		}
		window.localStorage.setItem('rPrHistory', JSON.stringify(history));
		$$('#radonPerRun').value = ewma;
		MODULES.surky.props.radonPerRun = $$('#radonPerRun').value;
	}
	if (parseFloat($$('#radonPerRun').value) < game.global.totalRadonEarned / 1e6) {
		// if a new user of the calculator happens to be starting from a battle spec or U1 save, give them a not completely stupid Rn/run value
		//  -> This is likely to be inaccurate and give shitty results for a few runs, but it's better than accepting some comparatively minuscule value incorrectly.
		rawRnRun = game.global.bestRadon / 5;
		if (!(rawRnRun > 30))
			rawRnRun = 30;
		$$('#radonPerRun').value = rawRnRun;
		MODULES.surky.props.radonPerRun = $$('#radonPerRun').value;
	}

	// calculate Scruffy level (adapted from Fluffy.getLevel() in the game source code)
	MODULES.surky.props.scruffyLevel = Math.floor(Math.log(((game.global.fluffyExp2 / 1000) * 3) + 1) / Math.log(4));

	var shield = null;
	if (game.global.universe === 2 && Object.keys(game.global.ShieldEquipped).length !== 0)
		shield = game.global.ShieldEquipped;
	else if (game.global.lastHeirlooms.u2 && game.global.lastHeirlooms.u2.Shield) {
		if (game.global.lastHeirlooms.u2.Shield === game.global.ShieldEquipped.id) {
			shield = game.global.ShieldEquipped;
		} else {
			shield = game.global.heirloomsCarried.find(function (s) {
				return s.id === game.global.lastHeirlooms.u2.Shield;
			});
		}
	}
	if (shield) {
		var critDamageMod = shield.mods.find(function (el) {
			return el[0] === "critDamage";
		});
		var prismalMod = shield.mods.find(function (el) {
			return el[0] === "prismatic";
		});
		var ineqMod = shield.mods.find(function (el) {
			return el[0] === "inequality";
		});

		if (critDamageMod) {
			MODULES.surky.props.shieldCD = Math.round(critDamageMod[1] / 10);
		} else {
			MODULES.surky.props.shieldCD = 0;
		}
		if (prismalMod) {
			MODULES.surky.props.shieldPrismal = Math.round(prismalMod[1]);
		} else {
			MODULES.surky.props.shieldPrismal = 0;
		}
		if (ineqMod) {
			MODULES.surky.props.healthDerate = Math.log(0.9 + ineqMod[1] / 10000) / Math.log(0.9)
		} else {
			MODULES.surky.props.healthDerate = 1;
		}
	}

	// Suprism gives 3% prismal shield per SA level
	var haveSuprism = autoBattle.oneTimers.Suprism.owned;
	if (haveSuprism)
		MODULES.surky.props.shieldPrismal += 3 * (autoBattle.maxEnemyLevel - 1);

	// read and process all input fields
	readInputs();
	MODULES.surky.props.perksRadon = (countHeliumSpent(false, true) + game.global.radonLeftover) + (portalWindowOpen ? game.resources.radon.owned : 0);
}

function getPerkCost(whichPerk, numLevels, fromZero = false) {
	if (numLevels === 0)
		return 0;
	var perk = MODULES.surky.perks[whichPerk];
	var level = fromZero ? 0 : perk.level;
	// if the perk can't be leveled, return infinite cost to naturally avoid buying the perk
	if (perk.locked || perk.hasOwnProperty("max") && (level + numLevels > perk.max))
		return Infinity;
	var cost = 0;
	for (var i = 0; i < numLevels; i++) {
		cost += Math.ceil(level / 2 + perk.priceBase * Math.pow(perk.priceFact, level));
		level++;
	}
	return cost;
}

function couldBuyPerk(whichPerk, actuallyBuy = false, numLevels = 1) {
	var perk = MODULES.surky.perks[whichPerk];
	if (perk.hasOwnProperty('max') && perk.level + numLevels > perk.max)
		return false;
	var cost = getPerkCost(whichPerk, numLevels);
	if (cost + MODULES.surky.props.radonSpent > MODULES.surky.props.perksRadon)
		return false;
	if (actuallyBuy) {
		MODULES.surky.props.radonSpent += cost;
		perk.level += numLevels;
	}
	return true;
}

function buyPerk(whichPerk, numLevels = 1) {
	return couldBuyPerk(whichPerk, true, numLevels);
}

function getGreedEffect(tribs) {
	if (tribs > 1250)
		tribs = 1250;
	tribs -= 600;
	var mod = 1.025;
	if (tribs > 0) {
		mod += (0.00015 * tribs);
		//+0.015% per tribute above 600
		mod += (Math.floor(tribs / 25) * 0.0035);
		//+0.35% per 25 tributes above 600
	}
	return mod;
}

// get the first-order feedback from Greed of a given boost to resources via more tributes
function getGreedResourceFeedback(resBoost, tribs) {
	if (tribs >= 1250)
		return [1, tribs];
	var tribsGained = Math.log(resBoost) / Math.log(1.05);
	if (tribs + tribsGained < 600)
		return [1, tribs];
	if (tribs + tribsGained > 1250)
		tribsGained = 1250 - tribs;
	if (tribs < 600)
		tribsGained = tribs + tribsGained - 600;
	// don't go by specific breakpoints which we'd be foolish to tie to a specific resource gain, just smooth the every-25 bonus out evenly per tribute
	var baseGreed = getGreedEffect(tribs);
	var greedGain = (baseGreed + 0.00029 * tribsGained) / baseGreed;
	return [Math.pow(greedGain, MODULES.surky.perks.Greed.level), tribs + tribsGained];
}

function getTenacityEffect(time) {
	if (time <= 60) {
		time *= (10 / 6)
	} else {
		time -= 60;
		time *= (2 / 6);
		time += 100;
	}
	return (1.1 + (Math.floor(time / 4) * 0.01));
}

function readInputs() {
	// get perk levels and locked/unlocked status, and calculate total Rn cost
	for (var [perkName, perkObj] of Object.entries(MODULES.surky.perks)) {
		if (typeof (perkObj) !== "object" || !perkObj.hasOwnProperty("optimize"))
			continue;
		// iterating over the perks, ignoring aux values
		perkObj.level = parseInt(MODULES.surky.perks[perkName].level) || 0;
		if (perkObj.hasOwnProperty("max") && perkObj.level > perkObj.max) {
			perkObj.level = perkObj.max;
		}
	}
	MODULES.surky.props.radonSpent = getTotalPerksCost();

	// reset the memoization results for the shinyTable, in case the target zone changed
	MODULES.surky.props.shinyTable = [0];
	// 0 obs = 0 trinkets (won't occur when obs is unlocked since there's 1 free level)

	// is GB used in the afterpush from farming?

	// should S3 & VS1 be counted for Rn gains? (i.e. are we chain farming?)
	// -> note at Obs 0 this will be assumed by the value calculation regardless of checked or not if clear weight is 0, else
	//      pushing perks would get no value whatsoever.

	// Accuracy doesn't matter prior to Obs, but 0 will give no value to radon gains so >0 is needed.
	MODULES.surky.props.radonPerRun = Math.max(1, MODULES.surky.props.radonPerRun);

	var logEnemyHealthScaling = Math.log(Math.sqrt(3.265) * 1.1 * 1.32);
	var logEnemyAttackScaling = Math.log(Math.sqrt(3.27) * 1.15 * 1.32);
	// final enemy HP/ATK scaling including the sqrt(zone) component:
	//   (note we don't divide by 2, because we're adding the two log sqrt components together)
	MODULES.surky.props.logEnemyScaling = logEnemyHealthScaling + logEnemyAttackScaling + Math.log(1 + 1 / MODULES.surky.props.targetZone);
	if (MODULES.surky.props.targetZone >= 300)
		MODULES.surky.props.logEnemyScaling += 2 * Math.log(1.15);

	// calculate equipment resource scaling for atk/hp based on weaponl/armor levels
	var wLevScaling = Math.pow((MODULES.surky.props.weaponLevels + 1) / (MODULES.surky.props.weaponLevels), 1 / Math.log(1.2));
	MODULES.surky.props.equipScaling = {};
	MODULES.surky.props.equipScaling.attack = Math.min(wLevScaling, Math.pow(Math.pow(1.19, 13), 1 / Math.log(Math.pow(1.069, (57 * 0.85)))));
	var aLevScaling = Math.pow((MODULES.surky.props.armorLevels + 1) / (MODULES.surky.props.armorLevels), 1 / Math.log(1.2));
	MODULES.surky.props.equipScaling.health = Math.min(aLevScaling, Math.pow(Math.pow(1.19, 14), 1 / Math.log(Math.pow(1.069, (57 * 0.85)))));

	// use tenacity time to calculate tenacity effect
	//   -> for any radon weight we presume we don't have high tenacity time (and radon will dominate for MF regardless)
	//   -> for no radon weight we presume we're pushing and care about tenacity more
	if (MODULES.surky.props.radonWeight > 0) {
		if (MODULES.surky.props.vmZone > 200) {
			MODULES.surky.props.tenacityTime = 40;
			// might matter a tiny bit for masterfulness in the post-Hypo meta :shrug:
		} else {
			MODULES.surky.props.tenacityTime = 10;
		}
	} else {
		MODULES.surky.props.tenacityTime = 120;
	}
	MODULES.surky.perks.Tenacity.effect = getTenacityEffect(MODULES.surky.props.tenacityTime);

	// triple-checking that coordlimited is not less than 0
	MODULES.surky.props.coordLimited = Number($$('#coordLimited').value);
	if (MODULES.surky.props.coordLimited < 0)
		MODULES.surky.props.coordLimited = 0;
	// let the user set coordLimited > 1 if they like to give extra population weight, despite saying they can't ;p
	//if (MODULES.surky.props.coordLimited > 1) MODULES.surky.props.coordLimited = 1;

	// approximate number of imp-orts of a given type per zone
	// FIXME someday: this isn't actually how randimps work.
	MODULES.surky.props.imperzone = (MODULES.surky.props.scruffyLevel >= 9 ? 3.5 : 3) + game.permaBoneBonuses.exotic.owned * 0.05 + 3.0 / 5;

	// get potency mod from target zone (div by 10 to get per-tick potency which is what's actually used in-game)
	MODULES.surky.props.potency = 0.00085 * Math.pow(1.1, Math.floor(MODULES.surky.props.targetZone / 5)) * Math.pow(1.003, MODULES.surky.props.targetZone * MODULES.surky.props.imperzone);

	// is our VM zone in the range for Hypo? then Glass can help us get more radon
	// TODO: expand this to any future radon challenges
	MODULES.surky.props.glassRadon = game.global.glassDone && (MODULES.surky.props.vmZone > 174 && MODULES.surky.props.vmZone < 200 || MODULES.surky.props.vmZone > 200);

	MODULES.surky.props.specialChallenge = $$('#preset').value;

	// calculate coefficients for tauntimp housing correction
	var housingTypes = {
		collector: [50, 1.12],
	}
	if (game.global.exterminateDone || MODULES.surky.props.specialChallenge === 'downsize') {
		housingTypes.hut = [1, 1.24];
		housingTypes.house = [1, 1.22];
		housingTypes.mansion = [9, 1.20];
		housingTypes.hotel = [15, 1.18];
		housingTypes.resort = [26, 1.16];
		housingTypes.gateway = [31, 1.14];
	}
	var coefC = 0;
	var termR = 0;
	var typeCount = 0;
	for (var [key, [startZone, scaling]] of Object.entries(housingTypes)) {
		var tauntRate = Math.pow(1.003, MODULES.surky.props.imperzone);
		var scaleZones = MODULES.surky.props.targetZone - startZone;
		var houseRate = Math.log(1.25) / Math.log(scaling);
		var taunTemp = Math.pow(tauntRate, scaleZones);
		var tauntRm1 = tauntRate - 1;
		var factor = (key === "collector") ? !autoBattle.oneTimers.Collectology.owned ? 1 : autoBattle.oneTimers.Collectology.getHubs() : 1;
		coefC += factor * (taunTemp - 1) / tauntRm1;
		termR += factor * tauntRate * houseRate * (taunTemp * (scaleZones * tauntRm1 - 1) + 1) / (tauntRm1 * tauntRm1);
		typeCount++;
	}
	MODULES.surky.props.coefC = coefC / typeCount;
	MODULES.surky.props.termR = termR / typeCount;
	// to a good approximation for zones substantially past the last housing unlock, total population (scaled by best housing base pop) is:
	//   <best housing count> * coefC - termR
	// So we can use these values to estimate the actual marginal gain in tauntimp-adjusted population.
}

function getTotalPerksCost() {
	var cost = 0;
	for (var [perkName, perkObj] of Object.entries(MODULES.surky.perks)) {
		if (typeof (perkObj) !== "object" || !perkObj.hasOwnProperty("optimize"))
			continue;
		// iterating over the perks, ignoring aux values
		cost += getPerkCost(perkName, perkObj.level, true);
	}
	return cost;
}

// Calculate the absolute Rn-equivalent value of gaining trinkets (RIP to relativism :<<<)
//    This is just the Rn cost of buying enough Mot/Pow/Tough to get the same boost to power stats as
//    a trinket would give you. The baseline above which we're measuring is whatever trinkets we'd expect
//    to have after next run if we didn't gain any marginal trinkets.
// We return 3 values:
//    1. The Rn value of all expected trinkets gained in a run at baseline perks.
//    2. The additional Rn value of a marginal trinket above those gained at baseline perks.
//    3. The baseline number of trinkets we expect to have at the end of the next run at current Obs.
// INPUTS:
//    gain factor at current level and cost for each of the basic powerlevel gain perks (Mot/Pow/Tough)
// NOTE that this weight does NOT capture the direct powerlevel gain value of more trinkets, which is captured elsewhere,
//   including feedback mechanisms via more resources and further pushing that aren't appropriate to use for "Radon-like"
//   growth weight. This is only capturing the long term growth value of additional trinket drops.
function getTrinketValues(motivCost, powCost, toughCost) {
	// trinket gain from pushing power will be 0 when Obs level is 0, so go ahead and calculate
	//   the value of trinket growth based on 1 Obs level to help evaluate the value of the first Obs
	//   level itself.
	var obsLevel = Math.max(1, 1 + MODULES.surky.perks.Observation.level);

	// Get the expected Rt at the end of the next run with the current Obs level.
	var shinies = 0;
	var shinies = game.portal.Observation.trinkets + shinyCollect(MODULES.surky.perks.Observation.level + 1);
	if (game.portal.Observation.trinkets === 0) {
		shinies += 10;
		// first Obs level gives 10 trinkets
	}
	shinies = Math.min(shinies, obsLevel * 1000);

	var cappedBaseTrinkets = Math.min(game.portal.Observation.trinkets, obsLevel * 1000);

	// marginal shine gain per run (for baseline perks)
	var marginalShinePerRun = (100 + shinies * obsLevel) / (100 + cappedBaseTrinkets * obsLevel);
	// marginal shine gain of one additional trinket
	var marginalShinePerTrinket = 1 + obsLevel / (100 + shinies * obsLevel);

	var res = [];
	for (var marginalShine of [marginalShinePerRun, marginalShinePerTrinket]) {
		// For each of Mot/Pow/Tough, presuming those levels are efficient, calculate the Rn cost of getting 
		//   the equivalent boost the marginal shine.
		// Total cost of N levels for a compounding price factor of F and next level cost of C:
		//   C/(F-1) * (F^N - 1)
		// Starting from a level of L, the gain factor of N more levels of any of these perks is:
		//   G = (100 + (L+N)*5)/(100 + L*5)
		// So solving for N we get:
		//   N = (G-1)*(20+L)
		var motF = MODULES.surky.perks.Motivation.priceFact;
		var motN = (marginalShine - 1) * (20 + MODULES.surky.perks.Motivation.level);
		var motShineCost = motivCost / (motF - 1) * (Math.pow(motF, motN) - 1);
		var powF = MODULES.surky.perks.Power.priceFact;
		var powN = (marginalShine - 1) * (20 + MODULES.surky.perks.Power.level);
		var powShineCost = powCost / (powF - 1) * (Math.pow(powF, powN) - 1);
		var touF = MODULES.surky.perks.Toughness.priceFact;
		var touN = (marginalShine - 1) * (20 + MODULES.surky.perks.Toughness.level);
		var touShineCost = toughCost / (touF - 1) * (Math.pow(touF, touN) - 1);
		// sum up all the costs of the powerlevel perks
		var totShineCost = motShineCost + powShineCost + touShineCost;
		res.push(totShineCost);
	}
	res.push(shinies);
	// also return the expected trinket count next run at baseline Obs level
	return res;
}

// Observation has a direct gain component (powering up each trinket), and a growth component (due to marginal trinket
//   droprate). This function returns the direct power gain (calculated based on the expected trinkets after the next run)
//   and the increase in trinkets gained next run specifically due to the droprate increase.
// Note this can calculate for any number of increased Obs levels, though we expect to use just +1 and +2.
//   +2 is useful because free trinkets at even levels are a major growth driver, so +2 levels may actually end up being
//   more cost efficient than +1 level at times.
function getObservationGains(levels) {
	var obsLevel = 1 + MODULES.surky.perks.Observation.level;
	// this gets referred to a lot, shortening the reference

	// Get expected trinket count at end of next run with the old Obs level
	var currentCollect = shinyCollect(obsLevel);
	var shinies = game.portal.Observation.trinkets + currentCollect;
	shinies = Math.min(shinies, obsLevel * 1000);
	// still need to re-bound in case we dropped an Obs level and have super-capped trinkets.

	// Get expected trinket count at end of next run with the new Obs level
	var nextCollect = shinyCollect(obsLevel + levels);
	var shiniesNext = game.portal.Observation.trinkets + nextCollect;
	if (game.portal.Observation.trinkets === 0)
		shiniesNext += 10;
	// 10 free trinkets for first Obs level
	shiniesNext = Math.min(shiniesNext, (obsLevel + levels) * 1000);

	// Calculate the direct gain in powerlevel at end of next run. Note this is the total powerlevel gain
	//   INCLUDING power immediately gained due to marginal trinket drops. This is because the Rn-like value
	//   of trinkets is valued as if those trinkets had no effect until the subsequent run (as true Rn
	//   gains on the next run would not have an effect within the same run).
	var directGain = (100 + shiniesNext * (obsLevel + levels)) / (100 + shinies * obsLevel);
	// upper bound on direct gain at re-capped trinkets:
	//   Obs value WITH droprate included can never exceed this value WITHOUT droprate included, if we're approaching
	//   our current trinket cap. No limit to droprate value if we are not approaching our cap.
	var maxDirectGain = Infinity;
	if (shinies >= obsLevel * 1000) {
		maxDirectGain = (100 + (obsLevel + levels) * (obsLevel + levels) * 1000) / (100 + obsLevel * shinies);
	}

	// Calculate the marginal gain in trinket power next run specifically due to the increased drop rate.
	//   We must consider ONLY the actual increase in trinkets on the save caused by the new Obs level(s).
	//   e.g. if you're at 12.5k and obs 12, we should only count the actual trinkets dropped next run at Obs 13,
	//   not the 500 trinkets that you already have on your save that only become unlocked this run (which is already
	//   accounted in the direct gain and does NOT represent an increase in drops).
	var moreTrinkets;
	if (game.portal.Observation.trinkets >= (obsLevel + levels) * 1000) {
		// Case 1: we're already capped even at the new obs level. No drop value.
		moreTrinkets = 0;
	} else if (game.portal.Observation.trinkets >= obsLevel * 1000) {
		// Case 2: we're already capped at the old obs level. Drop value is the actual drops gained this run.
		moreTrinkets = Math.max(0, shiniesNext - game.portal.Observation.trinkets);
	} else {
		// Case 3: we're not already capped. Drop value is the actual difference in gains between the two considered Obs levels.
		moreTrinkets = shiniesNext - shinies;
	}

	return [directGain, moreTrinkets, maxDirectGain];
}

// Do one iteration step of applying all gain feedback mechanisms in some semblance of a smart priority order
// INPUTS (also the output):
// values as gain factors: attack, health, metal, food, F/M/L, radon/growth, population, equality
// key values driving gain feedback to avoid endless positive feedback:
//   tribute count (for greed), collector count, are hubs enabled?, meteorologist count
// trinket droprate and trinket count (increase in trinket count must be converted to a value outside this function),
//   as well as the Obs level to consider for this valuation (in case we're evaluating Obs)
// also need to keep track of what gains have already been applied (and should not be continuously re-applied):
//   Vpushed = Va * Vh already applied
//   V<x>Done = V<x> already applied
// Everything from increased trinket count and onwards is optional, and defaults to values that should be passed at the
//   start of the iteration process (0 trinkets gained, all other gain values at 1 i.e. no gain)
// NOTE: "metal" includes gear discount here. if someday metal gain is a primary determinant of some
//   important mechanic other than equipment, there would need to be a separate gear discount input.
// NOTE: metal/food are MUTLIPLICATIVE gain over and above the unified F/M/L gain.
function iterateValueFeedback(valueArray) {
	var [Va, Vh, Vm, Vf, Vres, Vrad, Vp, Ve,
		tribs, collectors, hubEnabled, mets,
		trinketRate, trinkets, obsLevel,
		Vpushed = 1, VmDone = 1, VfDone = 1, VresDone = 1, VpDone = 1] = valueArray;


	// when tribute count is < 1250, resource->resource/radon feedback is strong via Greed
	if (tribs < 1250) {
		var [greedback, tribs] = getGreedResourceFeedback(Vf * Vres / (VfDone * VresDone), tribs);
		Vres *= greedback;
		Vrad *= greedback;
	}

	// more resources buy more housing, which feeds back to more resources and population
	//  -> Don't bother with this small correction below Collectors, especially since Gateways don't scale with F/M/L.
	//     Frags do scale with "some" resource boosts, but approximating them as non-scaling as a general rule is pretty close to correct.
	var moreHousing = Math.log(Vf * Vres / (VfDone * VresDone)) / Math.log(1.12); // Collectors scale with food (no other basic resources needed)
	var baseHousing = collectors;
	// for downsize we make the same adjustments as for hubs, just saying "all housing buildings have the same value"
	if (game.global.exterminateDone || MODULES.surky.props.specialChallenge === 'downsize') {
		moreHousing *= !autoBattle.oneTimers.Collectology.owned ? 1 : autoBattle.oneTimers.Collectology.getHubs();
		moreHousing += 5 * Math.log(Vres / VresDone) / Math.log(1.2); // 5 housing types below Gateway need wood, roughly 1.2 avg scaling (Gateway doesn't scale)
		baseHousing *= 6 + !autoBattle.oneTimers.Collectology.owned ? 1 : autoBattle.oneTimers.Collectology.getHubs(); // estimate all housing types have the same number as Collectors (close enough for gain factor w.r.t. the small feedback effects here)
	}
	// if the user doesn't have collectors yet, don't bother with housing corrections (yes this will exclude O.G. downsize, tough)
	//   (tauntimp correction uses coefC & termR calculated in readInput(), based on target zone)
	var tauntCorrectedHousingBase = baseHousing * MODULES.surky.props.coefC - MODULES.surky.props.termR;
	var tauntCorrectedHousingNext = (baseHousing + moreHousing) * MODULES.surky.props.coefC - MODULES.surky.props.termR;
	var housingGain = tauntCorrectedHousingNext / tauntCorrectedHousingBase;
	if (!(housingGain > 1) || tauntCorrectedHousingBase <= 0) housingGain = 1;
	if (MODULES.surky.props.specialChallenge === 'downsize') {
		// 2 territory bonuses per zone, each bonus is 5 + trumps level
		var trumPop = 2 * MODULES.surky.props.targetZone * (5 + MODULES.surky.perks.Trumps.level);
		// actual gain: (housing * housingGain + trumpop) / (housing + trumpop)
		housingGain = 1 + (housingGain - 1) * baseHousing / (baseHousing + trumPop);
	}
	Vres *= housingGain;
	Vp *= ((MODULES.surky.props.specialChallenge === 'trappa') || (MODULES.surky.props.specialChallenge === 'combat') || (MODULES.surky.props.specialChallenge === 'combatRadon'))
		? 1 : housingGain; // Trappa housing doesn't help buy more coords. Combat respec assumes we're done buying housing.
	collectors += housingGain;

	// use equip scaling to convert resource value to atk/hp value
	var VmAdjusted = Vm * Vres / (VmDone * VresDone);
	// combat spec assumes no more equipment buying
	if (!(MODULES.surky.props.specialChallenge === 'combat') && !(MODULES.surky.props.specialChallenge === 'combatRadon')) {
		Va *= Math.pow(MODULES.surky.props.equipScaling.attack, Math.log(VmAdjusted));
		Vh *= Math.pow(MODULES.surky.props.equipScaling.health, Math.log(VmAdjusted));
	}

	// account for smithies: 1.25x atk/hp per 50x resources (40x with S14)
	var smithyGain = Math.pow(1.25, Math.log(Vres / VresDone) / Math.log(MODULES.surky.props.scruffyLevel >= 14 ? 40 : 50));
	// combat spec assumes no more smithy buying
	if (!(MODULES.surky.props.specialChallenge === 'combat') && !(MODULES.surky.props.specialChallenge === 'combatRadon') && !(MODULES.surky.props.specialChallenge === 'smithless')) {
		Va *= smithyGain;
		Vh *= smithyGain;
	}

	// if coord limited, account for population gain to coords
	var coordAdjust = MODULES.surky.props.coordLimited;
	if (MODULES.surky.props.specialChallenge === 'downsize') {
		// assume coord limited in downsize (allowing the user to weight further toward pop if desired)
		coordAdjust = Math.max(coordAdjust, 1);
	} else if (MODULES.surky.props.specialChallenge === 'trappa' || MODULES.surky.props.specialChallenge === 'combat' && challengeActive('Trappapalooza')) {
		// Trappa is always coord limited, and the input field is hidden (replaced by the trapping hours field)
		coordAdjust = 1;
	} else if (MODULES.surky.props.specialChallenge === 'combat' || MODULES.surky.props.specialChallenge === 'combatRadon') {
		// combat respec reads the actual population/coordinations from the save to determine how many levels of Carp are needed
		coordAdjust = (MODULES.surky.perks.Carpentry.level < MODULES.surky.props.carpNeeded) ? 1 : 0;
	}
	var coordGain = Math.pow(1.25, Math.log(Vp / VpDone) / Math.log(1.25) * coordAdjust);
	Va *= coordGain;
	Vh *= coordGain;

	// more food buys more Mets, which have various effects depending on antennas
	var moreMets = Math.log(Vf * Vres / (VfDone * VresDone)) / Math.log(5);
	var metEff = 0.01 + 0.0005 * game.buildings.Antenna.owned;
	var metRes = 0.5 + 0.25 * (game.buildings.Antenna.owned >= 20 ? (Math.floor(game.buildings.Antenna.owned / 5) - 3) : 0);
	var metProd = mets * metEff;
	var metProdNext = (mets + moreMets) * metEff;
	var metRadGain = (1 + metProdNext) / (1 + metProd);
	var metFoodGain = game.buildings.Antenna.owned >= 5 ? (1 + metProdNext * metRes) / (1 + metProd * metRes) : 1;
	var metHPGain = game.buildings.Antenna.owned >= 10 ? (1 + metProdNext * metRes) / (1 + metProd * metRes) : 1;
	var metMineGain = game.buildings.Antenna.owned >= 15 ? (1 + metProdNext * metRes) / (1 + metProd * metRes) : 1;
	Vrad *= metRadGain;
	Vf *= metFoodGain;
	if (!(MODULES.surky.props.specialChallenge === 'combat') && !(MODULES.surky.props.specialChallenge === 'combatRadon')) Vh *= metHPGain;
	Vm *= metMineGain;
	mets += moreMets;

	// Feedback from pushing power (final trappa respec: health won't be applied after last army send, so don't count health)
	var pushPower = Va * ((MODULES.surky.props.specialChallenge === 'combat' && challengeActive('Trappapalooza')) ? 1 : Vh) / Vpushed;
	var pushZones = Math.log(pushPower) / MODULES.surky.props.logEnemyScaling;
	// speedbooks give 25% resources per zone
	if (MODULES.surky.props.specialChallenge === 'resplus') {
		// when collecting resources from +maps, we only get 10% resource gain per map
		Vres *= Math.pow(1.1, pushZones);
	} else {
		Vres *= Math.pow(1.25, pushZones);
	}
	// coords give 25% atk/hp per zone IF NOT COORD LIMITED
	Va *= Math.pow(1.25, pushZones * (1 - Math.min(1, coordAdjust)));
	Vh *= Math.pow(1.25, pushZones * (1 - Math.min(1, coordAdjust)));

	// Glass reward gives 10% radon per extra completion if we can increase our VM zone (determined in readInputs())
	if (MODULES.surky.props.clearWeight >= 0 && MODULES.surky.props.glassRadon) {
		Vrad *= Math.pow(1.1, pushZones);
	}

	// count S3 for Rn weighting if selected by the user, or if at Obs 0 with no clear weight (which would give no value to pushing perks at all without S3/VS1)
	//   -> or no clear weight and trinkets capped
	var s3RnFinal = MODULES.surky.props.scruffyLevel >= 3;
	// Scruffy level 3 gives compounding 3% Rn per additional zone
	if (s3RnFinal) {
		Vrad *= Math.pow(1.03, pushZones);
		// VS1 gives additive 0.25% VM Rn per additional zone
		// TODO: MODULES.surky.vmRadFrac is a hacky constant for now, should probably be a user input after we clean up the volume of user inputs
		Vrad *= 1 + 0.6 * pushZones / (400 + MODULES.surky.props.targetZone);
	}
	// trinket gain: use a fixed drop rate based on target zone, which should be fine assuming the user has entered
	//   a sensible value and we're only optimizing at the margins of a fractional zone (or maybe 1-2 zones)
	moreTrinkets = pushZones * trinketRate;
	var trinketMax = 1000 * obsLevel;
	if (moreTrinkets + trinkets > trinketMax) moreTrinkets = trinketMax - trinkets;
	if (moreTrinkets < 0) throw ("Unexpectedly tried to value more trinkets than our trinket max!: " + trinkets);
	trinketGain = 1 + moreTrinkets * obsLevel / (100 + trinkets * obsLevel);
	Va *= trinketGain;
	Vh *= trinketGain;
	Vres *= trinketGain;
	trinkets += moreTrinkets;

	// copy the values back into the same array reference rather than creating a new array
	// WARNING: If any of these positions change, we also must update getLogWeightedValue appropriately
	valueArray[0] = Va;
	valueArray[1] = Vh;
	valueArray[2] = Vm;
	valueArray[3] = Vf;
	valueArray[4] = Vres;
	valueArray[5] = Vrad;
	valueArray[6] = Vp;
	valueArray[7] = Ve;
	valueArray[8] = tribs;
	valueArray[9] = collectors;
	//valueArray[10] = hubEnabled;
	valueArray[11] = mets;
	//valueArray[12] = trinketRate;
	valueArray[13] = trinkets;
	//valueArray[14] = obsLevel;
	valueArray[15] = Va * ((MODULES.surky.props.specialChallenge === 'combat' && challengeActive('Trappapalooza')) ? 1 : Vh);
	valueArray[16] = Vm;
	valueArray[17] = Vf;
	valueArray[18] = Vres;
	valueArray[19] = Vp;
}

// Inputs: gain values for atk, hp, equip discount (or metal), radon, equality, pop
//         moreTrinkets: increased count of trinkets on next run from Obs droprate increase
function getLogWeightedValue(Va, Vh, Vgear, Vres, Vrad, Ve = 1, Vp = 1, moreTrinkets = 0, extraObs = 0) {

	var iterateValueLoops = 3;
	var Wa = MODULES.surky.props.clearWeight; // attack weight
	// health is useless in final trappa respec after sending last army, since new perks won't be applied to current army's health
	var Wh = (MODULES.surky.props.specialChallenge === 'combat' && challengeActive('Trappapalooza')) ? 0 : MODULES.surky.props.clearWeight * MODULES.surky.props.healthDerate + MODULES.surky.props.survivalWeight; // health weight
	var We = Math.max(1e-100, MODULES.surky.props.survivalWeight); // equality weight: force >0 to use equality as a dump perk if the user sets 0 weight
	var Wr = MODULES.surky.props.radonWeight; // radon weight

	// from iterateValueFeedback:
	//   [Va,Vh,Vm,Vf,Vres,Vrad,Vp,Ve,
	//    tribs,collectors,hubEnabled,mets,
	//    trinketRate,trinkets,obsLevel,
	//    Vpushed=1,VmDone=1,VfDone=1,VresDone=1,VpDone=1] = valueArray;

	// add Obs levels if we're evaluating Observation
	var obsLevel = 1 + MODULES.surky.perks.Observation.level + extraObs;

	var valueArray = [Va, Vh, Vgear, 1, Vres, Vrad, Vp, Ve,
		MODULES.surky.props.tributes, MODULES.surky.props.housingCount, game.global.exterminateDone, MODULES.surky.props.meteorologists,
		obsDropRate(obsLevel, MODULES.surky.props.targetZone) / 100, MODULES.surky.props.baselineTrinketsNext, obsLevel,
		1, 1, 1, 1, 1,
	];

	for (var i = 0; i < iterateValueLoops; i++)
		iterateValueFeedback(valueArray);

	Va = valueArray[0];
	Vh = valueArray[1];
	Vm = valueArray[2];
	Vres = valueArray[4];
	Vrad = valueArray[5];
	Ve = valueArray[7];
	Vtrink = valueArray[13];

	// only count actual new trinket drops, not extra "apparent" trinkets from cap increase!
	moreTrinkets += Math.max(0, Vtrink - Math.max(MODULES.surky.props.baselineTrinketsNext, game.portal.Observation.trinkets));

	// calculate unified Rn-like growth gain:
	var Vgrowth = (Vrad * MODULES.surky.props.radonPerRun + MODULES.surky.props.trinketRadonPerRun
		+ MODULES.surky.props.radonPerTrinket * moreTrinkets
	) / (MODULES.surky.props.radonPerRun + MODULES.surky.props.trinketRadonPerRun);

	if (MODULES.surky.props.specialChallenge === 'combat') Vgrowth = 1; // ignore radon weight for combat spec

	// A perk's total weighted value is:
	//   Va^Wa * Vh^Wh * Ve^We * Vrad^Wr.
	// For cost-efficiency between perks with wildly different costs & effects we use the log of this value, which simplifies to:
	//   Wa*log(A) + Wh*log(H) + We*log(E) + Wr*log(R)

	var res = Wa * Math.log(Va) + Wh * Math.log(Vh) + We * Math.log(Ve) + Wr * Math.log(Vgrowth);
	if (MODULES.surky.props.specialChallenge === 'resplus' || MODULES.surky.props.specialChallenge === 'resminus') {
		res = Math.log(Vres) + (1e-100) * Math.log(Ve); // hack to still use equality as a primary dump perk
	}
	if (MODULES.surky.props.specialChallenge === 'equip') {
		res = Math.log(Vres * Vm) + (1e-100) * Math.log(Ve); // for equip farming, Artisanistry also counts
	}
	if (isNaN(res)) {
		console.log("ERROR: NaN result!")
	}
	return res;
}

function obsDropRate(level, zone) {
	if (zone < 101)
		return 0;
	if (zone > 200)
		zone = 200;
	var base = ((1 + ((level - 1) / 2)) * Math.pow(1.03, (zone - 100)));
	var res;
	if (MODULES.surky.props.specialChallenge === 'alchemy' && zone <= 156) {
		res = 100 - (100 - base) * Math.pow(0.99, +$$('#findPots').value);
	} else
		res = base;
	return res;
}

// how many trinkets do we expect to get by clearing the target zone?
function shinyCollectLoop(level, zone) {
	var shinies = 0;
	// the game checks for the drop after advancing the zone counter, so go to zone+1.
	for (var i = 101; i <= zone + 1; i++) {
		shinies += obsDropRate(level, i) / 100;
		if (i % 25 === 0) {
			// level-1 since the "level" includes the free +1 obs level, but even levels for guaranteed trinket drops do not include this free +1 level
			var free = Math.floor((level - 1) / 2);
			if (free > 0)
				shinies += free;
		}
	}
	return shinies;
}

// zone === targetZone, memoized by a lookup table calculated by shinyCollectLoop
function shinyCollect(level) {
	if (typeof MODULES.surky.props.shinyTable[level] === 'undefined') {
		MODULES.surky.props.shinyTable[level] = shinyCollectLoop(level, MODULES.surky.props.targetZone);
	}
	return MODULES.surky.props.shinyTable[level];
}

// Calculate avg atk with frenzy, accounting for uptime.
//   Optimizing for a given hit count (in practice maybe just 5 and 100, where 100 gives a pretty good approximation of deathless)
function getFrenzyAvgAtk(level, frenzyHits) {
	var frenzyDeathTime = 0.4 + 0.258 * frenzyHits
	// get off N hits then die, optimizing for Hyperspeed 1
	var frenzyHitTime = frenzyDeathTime / frenzyHits;
	// get off N hits then die
	var frenzyProcChance = MODULES.surky.perks.Frenzy.procEffect * level;
	// wait time in seconds
	var frenzyProcWaitTime = frenzyHitTime / frenzyProcChance;
	// frenzy uptime for each proc
	var frenzyUptimePerProc = frenzyDeathTime * Math.log(MODULES.surky.perks.Frenzy.timeEffect * level / frenzyDeathTime + 1) / Math.log(2);
	// uptime fraction for weighting the attack bonus
	var frenzyUptimeFrac = frenzyUptimePerProc / (frenzyProcWaitTime + frenzyUptimePerProc);
	// Mass Hysteria means frenzy is always up
	if (autoBattle.oneTimers.Mass_Hysteria.owned) {
		frenzyUptimeFrac = 1;
	}
	// average attack per hit accounting for uptime fraction
	var frenzyAvgAtk = 1 + frenzyUptimeFrac * MODULES.surky.perks.Frenzy.effect * level;
	return frenzyAvgAtk;
}

// flag the most efficient perk
function efficiencyFlag(eList = [], pList = []) {
	var bestEff = 0;
	var bestAffordableEff = 0;
	var bestPerk = "";
	// don't flag a perk if we don't find an affordable one!
	for (var [perkName, perkObj] of Object.entries(MODULES.surky.perks)) {
		if (typeof (perkObj) !== "object" || !perkObj.hasOwnProperty("optimize") || !perkObj.optimize) {
			continue;
		}
		// iterating over the perks, ignoring aux values
		eList.push(perkObj.efficiency);
		pList.push(perkName);
		if (perkObj.efficiency > bestEff) {
			bestEff = perkObj.efficiency;
		}
		// don't buy level-locked perks
		if (couldBuyPerk(perkName, false) && perkObj.efficiency > bestAffordableEff) {
			bestAffordableEff = perkObj.efficiency;
			bestPerk = perkName;
		}
		if (perkObj.hasOwnProperty("efficiency2")) {
			if (perkObj.efficiency2 > bestEff) {
				bestEff = perkObj.efficiency2;
			}
			if (couldBuyPerk(perkName, false, 2) && perkObj.efficiency2 > bestAffordableEff) {
				bestAffordableEff = perkObj.efficiency2;
				bestPerk = perkName;
			}
		}
	}
	return bestPerk;
}

// get perk efficiencies at current levels and color code them accordingly
var evaluatePerks = function () {
	readInputs();
	// calculate the efficiency of each perk
	getPerkEfficiencies();
}

function getPerkEfficiencies() {
	// TODO: most perks don't change other perks' efficiencies (given our assumptions of local flatness)
	//  So move the efficiency calculations to functions owned by each perk, and only update efficiency when actually
	//  buying a perk. Notable exception for Observation (and carefully look for other exceptions), which will require
	//  some exception mechanism to update interdependent perks' efficiencies.
	// Now that we're doing a complex feedback iteration process for each perk efficiency, this is going to become necessary
	//  to avoid exploding computation time.

	// used for combat respec to determine exactly how much carp is needed to afford all coords (given we require an appropriate save for this preset)
	//   -> max army size before buying final coord is 1/3 of population
	var moreCoordsNeeded = Math.max(0, MODULES.surky.props.targetZone - game.upgrades.Coordination.done);
	var popNeededForCoords = 3 * Math.pow(1.25, moreCoordsNeeded) * game.resources.trimps.maxSoldiers;
	var tauntBase = 1.003 + 0.0001 * MODULES.surky.perks.Expansion.level;
	var tauntMult = game.global.expandingTauntimp ? Math.pow(tauntBase, game.unlocks.impCount.Tauntimp) : 1;
	// expanding tauntimps mean taunt pop is not in maxTrimps, it's a flat multiplier
	var tauntCorrectedMaxTrimps = tauntMult * ((game.resources.trimps.max * game.resources.trimps.maxMod) * autoBattle.bonuses.Scaffolding.getMult()) * Math.pow(tauntBase, MODULES.surky.props.imperzone * (MODULES.surky.props.targetZone - game.global.world));
	MODULES.surky.props.carpNeeded = Math.log(popNeededForCoords / tauntCorrectedMaxTrimps) / Math.log(1.1);

	// Get various gain factors needed to calculate the value of trinkets (and also used to value their respective perks).
	//  Motivation
	var motiv = 1 + MODULES.surky.perks.Motivation.level * MODULES.surky.perks.Motivation.effect;
	var motivGain = (motiv + MODULES.surky.perks.Motivation.effect) / motiv;
	// trappa is heavily drop-based prior to 160, and mostly gathering based after 170
	if (MODULES.surky.props.specialChallenge === 'trappa') {
		if (MODULES.surky.props.targetZone < 162) {
			motivGain = Math.pow(motivGain, 0.0001);
			// derate motivation in trappa (don't want to zero it out but it doesn't increase F/M/L meaningfully)
		} else if (MODULES.surky.props.targetZone < 172) {
			motivGain = Math.pow(motivGain, 0.5);
		}
	}
	var motivCost = getPerkCost("Motivation", 1);
	// Power
	var pow = 1 + MODULES.surky.perks.Power.level * MODULES.surky.perks.Power.effect;
	var powGain = (pow + MODULES.surky.perks.Power.effect) / pow;
	var powCost = getPerkCost("Power", 1);
	// Toughness
	var tough = 1 + MODULES.surky.perks.Toughness.level * MODULES.surky.perks.Toughness.effect;
	var toughGain = (tough + MODULES.surky.perks.Toughness.effect) / tough;
	var toughCost = getPerkCost("Toughness", 1);

	// Get the absolute Rn values for trinkets expected at baseline Observation and per marginal trinket,
	//   and the expected count of trinkets at the end of this run at baseline Observation.
	[MODULES.surky.props.trinketRadonPerRun, MODULES.surky.props.radonPerTrinket, MODULES.surky.props.baselineTrinketsNext] = getTrinketValues(motivCost, powCost, toughCost);

	// Artisanistry:
	//   resource gain for equipment only
	MODULES.surky.perks.Artisanistry.efficiency = getLogWeightedValue(1, 1, MODULES.surky.perks.Artisanistry.effect, 1, 1, 1) / getPerkCost("Artisanistry", 1);

	// Bait:
	//   population in Trappa, but derate resource gains like for Motivation
	if (MODULES.surky.props.specialChallenge === 'trappa' && challengeActive('Trappapalooza')) {
		// 3600 seconds per hr, 10 ticks per second, 10x base trimps per tick (S0 ability)
		var baitTime = 3600 * 10 * 10 * MODULES.surky.props.trapHrs;
		var totalBaitPopBase = baitTime * (1 + MODULES.surky.perks.Bait.level);
		var totalBaitPopNext = baitTime * (2 + MODULES.surky.perks.Bait.level);
		var baitPop = (totalBaitPopNext + MODULES.surky.props.trappaStartPop) / (totalBaitPopBase + MODULES.surky.props.trappaStartPop);
		MODULES.surky.perks.Bait.efficiency = getLogWeightedValue(1, 1, 1, Math.pow(baitPop, 0.0001), 1, 1, baitPop) / getPerkCost("Bait", 1);
	}

	// Expansion
	//   Assume Expanding Tauntimps, so all expected Tauntimps for target zone are applied
	var expandotaunts = MODULES.surky.props.targetZone * MODULES.surky.props.imperzone;
	var expandobase = 1 + 1 / (10030 + MODULES.surky.perks.Expansion.level);
	var expandogain = Math.pow(expandobase, expandotaunts);

	// Carpentry:
	//   population gain, also gives resources
	var carpPop = MODULES.surky.perks.Carpentry.effect;
	if (MODULES.surky.props.specialChallenge === 'trappa' || MODULES.surky.props.specialChallenge === 'combat' && challengeActive('Trappapalooza')) {
		// In Trappa, carp gives more housing which gives more drops, but does not increase available Trimps
		MODULES.surky.perks.Carpentry.efficiency = getLogWeightedValue(1, 1, 1, carpPop, 1, 1, 1) / getPerkCost("Carpentry", 1);
		MODULES.surky.perks.Expansion.efficiency = getLogWeightedValue(1, 1, 1, expandogain, 1, 1, 1) / getPerkCost("Expansion", 1);
	} else {
		MODULES.surky.perks.Carpentry.efficiency = getLogWeightedValue(1, 1, 1, carpPop, 1, 1, carpPop) / getPerkCost("Carpentry", 1);
		MODULES.surky.perks.Expansion.efficiency = getLogWeightedValue(1, 1, 1, expandogain, 1, 1, expandogain) / getPerkCost("Expansion", 1);
	}

	// Trumps:
	//   population in downsize
	if (MODULES.surky.props.specialChallenge === 'downsize') {
		// estimate same number of each housing building, should be "good enough"
		var buildPop = (game.global.exterminateDone ? (13 + !autoBattle.oneTimers.Collectology.owned ? 1 : autoBattle.oneTimers.Collectology.getHubs()) : 7) * MODULES.surky.props.housingCount;
		// 2 territory bonuses per zone, each bonus is 5 + trumps level
		var baseTrumPop = 2 * MODULES.surky.props.targetZone * (5 + MODULES.surky.perks.Trumps.level);
		var trumPop = (buildPop + baseTrumPop + 2 * MODULES.surky.props.targetZone) / (buildPop + baseTrumPop);
		MODULES.surky.perks.Trumps.efficiency = getLogWeightedValue(1, 1, 1, trumPop, 1, 1, trumPop) / getPerkCost("Trumps", 1);
	}

	// Criticality:
	//   attack gain from crits
	var CD = 1 + MODULES.surky.props.shieldCD / 100 + MODULES.surky.perks.Criticality.level * MODULES.surky.perks.Criticality.effect;
	var CC = (MODULES.surky.props.specialChallenge === 'duel') ? 0.5 : 1;
	// derate crit chance for duel
	var critGain = ((1 - CC) + CC * (CD + MODULES.surky.perks.Criticality.effect)) / ((1 - CC) + CC * CD);
	MODULES.surky.perks.Criticality.efficiency = getLogWeightedValue(critGain, 1, 1, 1, 1, 1) / getPerkCost("Criticality", 1);

	// Equality:
	MODULES.surky.perks.Equality.efficiency = getLogWeightedValue(1, 1, 1, 1, 1, MODULES.surky.perks.Equality.effect) / getPerkCost("Equality", 1);

	// Championism:
	MODULES.surky.perks.Championism.efficiency = getLogWeightedValue(1.01 + 0.005 * (autoBattle.maxEnemyLevel - 1), 1.01 + 0.005 * (autoBattle.maxEnemyLevel - 1), 1, 1, 1, 1) / getPerkCost("Championism", 1);

	// Frenzy
	//   attack boost when frenzy is active
	// Frenzy should be based on 5-hit deaths iff relying on GB for at least one zone of the run is good.
	//    We presume this is always true if you have any pushing weight.
	//    With no pushing weight, we presume it's FALSE (optimizing for 300 hits instead) unless a 3-minute zone would yield enough radon/trinket gains to be good, which roughly corresponds to when GB is useful.
	if (MODULES.surky.props.specialChallenge !== 'berserk') {
		var frenzyHits = 300;
		var isDeathless = MODULES.surky.props.specialChallenge === 'resplus' || MODULES.surky.props.specialChallenge === 'resminus' || MODULES.surky.props.specialChallenge === 'trappa' || MODULES.surky.props.specialChallenge === 'combat' && challengeActive('Trappapalooza');
		if (!isDeathless && MODULES.surky.props.clearWeight > 0 || MODULES.surky.props.gbAfterpush) {
			frenzyHits = 5;
		}
		var frenzyAvgAtk = getFrenzyAvgAtk(MODULES.surky.perks.Frenzy.level, frenzyHits);
		var frenzyAvgAtkNext = getFrenzyAvgAtk(MODULES.surky.perks.Frenzy.level + 1, frenzyHits);
		var frenzyGain = frenzyAvgAtkNext / frenzyAvgAtk;
		MODULES.surky.perks.Frenzy.efficiency = getLogWeightedValue(frenzyGain, 1, 1, 1, 1, 1) / getPerkCost("Frenzy", 1);
	}

	// Greed:
	//   all-resource and radon gain
	var greedGain = getGreedEffect(MODULES.surky.props.tributes);
	MODULES.surky.perks.Greed.efficiency = getLogWeightedValue(1, 1, 1, greedGain, greedGain, 1) / getPerkCost("Greed", 1);

	// Looting:
	//   all-resource and radon gain
	var loot = 1 + MODULES.surky.perks.Looting.level * MODULES.surky.perks.Looting.effect;
	var lootGain = (loot + MODULES.surky.perks.Looting.effect) / loot;
	var lootCost = getPerkCost("Looting", 1);
	MODULES.surky.perks.Looting.efficiency = getLogWeightedValue(1, 1, 1, lootGain, lootGain, 1) / lootCost;

	// Motivation:
	//   all-resource gain (no radon)
	// Note motivGain is already derated for Trappa above
	MODULES.surky.perks.Motivation.efficiency = getLogWeightedValue(1, 1, 1, motivGain, 1, 1) / motivCost;

	// Packrat:
	//   all-resource gain from decreased storage costs (no radon)
	// Note: 0.125 because you only pay taxes on the half of your last storage that you filled before buying it
	// Note: / 2 because we might guess you spend as many resources as you can store after your last storage building
	var storeTax = 0.125 / (1 + MODULES.surky.perks.Packrat.level * MODULES.surky.perks.Packrat.effect) / 2;
	var storeTaxNext = 0.125 / (1 + (MODULES.surky.perks.Packrat.level + 1) * MODULES.surky.perks.Packrat.effect) / 2;
	var ratGain = (1 - storeTaxNext) / (1 - storeTax);
	MODULES.surky.perks.Packrat.efficiency = getLogWeightedValue(1, 1, 1, ratGain, 1, 1) / getPerkCost("Packrat", 1);

	// Pheromones
	//   Count 3-tick breeding as 100% uptime, and weight for comparative uptime at target zone
	if (MODULES.surky.props.specialChallenge === 'trappa' || MODULES.surky.props.specialChallenge === 'combat' && challengeActive('Trappapalooza')) {
		// no breeding is the challenge.
		MODULES.surky.perks.Pheromones.efficiency = 0;
	} else {
		var breedSpeed = 1 + MODULES.surky.props.potency * (1 + MODULES.surky.perks.Pheromones.level * MODULES.surky.perks.Pheromones.effect);
		var breedUptime = 3 / Math.max(3, Math.log(2) / Math.log(breedSpeed));
		var breedSpeedNext = 1 + MODULES.surky.props.potency * (1 + (MODULES.surky.perks.Pheromones.level + 1) * MODULES.surky.perks.Pheromones.effect);
		var breedUptimeNext = 3.001 / Math.max(3, Math.log(2) / Math.log(breedSpeedNext));
		var breedGain = breedUptimeNext / breedUptime;
		MODULES.surky.perks.Pheromones.efficiency = getLogWeightedValue(breedGain, 1, 1, 1, 1, 1) / getPerkCost("Pheromones", 1);
	}

	// Power:
	//   attack gain
	MODULES.surky.perks.Power.efficiency = getLogWeightedValue(powGain, 1, 1, 1, 1, 1) / powCost;

	// Prismal:
	//   health gain from increased shielding
	var prismLayers = 1;
	var basePrismal = MODULES.surky.props.shieldPrismal + 100;
	if (MODULES.surky.props.scruffyLevel >= 1)
		basePrismal += 25;
	if (MODULES.surky.props.scruffyLevel >= 10)
		prismLayers = 2;
	if (MODULES.surky.props.scruffyLevel >= 16)
		prismLayers = 3;
	var prismHP = 1 + (basePrismal / 100 + MODULES.surky.perks.Prismal.level * MODULES.surky.perks.Prismal.effect) * prismLayers;
	var prismGain = (prismHP + MODULES.surky.perks.Prismal.effect * prismLayers) / prismHP;
	// hack for trappa final respec: prismal DOES matter even though raw health doesn't, so pretend it's attack
	MODULES.surky.perks.Prismal.efficiency = getLogWeightedValue(((MODULES.surky.props.specialChallenge === 'combat' && challengeActive('Trappapalooza')) ? prismGain : 1), prismGain, 1, 1, 1, 1) / getPerkCost("Prismal", 1);

	// Resilience:
	//   health gain (compounding)
	MODULES.surky.perks.Resilience.efficiency = getLogWeightedValue(1, MODULES.surky.perks.Resilience.effect, 1, 1, 1, 1) / getPerkCost("Resilience", 1);

	// Tenacity:
	//   attack gain (compounding, pre-calculated into the effect field)
	MODULES.surky.perks.Tenacity.efficiency = getLogWeightedValue(MODULES.surky.perks.Tenacity.effect, 1, 1, 1, 1, 1) / getPerkCost("Tenacity", 1);

	// Toughness:
	//   health gain
	MODULES.surky.perks.Toughness.efficiency = getLogWeightedValue(1, toughGain, 1, 1, 1, 1) / toughCost;

	// Observation:
	//  See getObservationGains for more details on valuation.
	// NOTE we check for +1 and +2 levels, as +2 levels can be more efficient due to the extra free trinket drop.  
	// Max possible gain is what you'd get from instantly trinket-capping the new Obs level, so upper bound by that.
	var [obsDirectGain, obsMoreTrinkets, obsMaxDirectGain] = getObservationGains(1);
	MODULES.surky.perks.Observation.efficiency = Math.min(getLogWeightedValue(obsDirectGain, obsDirectGain, 1, obsDirectGain, 1, 1, 1, obsMoreTrinkets, 1), obsMaxDirectGain < Infinity ? getLogWeightedValue(obsMaxDirectGain, obsMaxDirectGain, 1, obsMaxDirectGain, 1, 1, 1, 0, 1) : Infinity) / getPerkCost("Observation", 1);

	// No point checking for 2-level efficiency if we can't afford 2 levels.
	// (And more to the point, it breaks the way we flag the best perk if we give non-zero efficiency for the 2-level version....)
	if (couldBuyPerk("Observation", false, 2)) {
		var [obsDirectGain2, obsMoreTrinkets2, obsMaxDirectGain2] = getObservationGains(2);
		MODULES.surky.perks.Observation.efficiency2 = Math.min(getLogWeightedValue(obsDirectGain2, obsDirectGain2, 1, obsDirectGain2, 1, 1, 1, obsMoreTrinkets2, 2), obsMaxDirectGain2 < Infinity ? getLogWeightedValue(obsMaxDirectGain2, obsMaxDirectGain2, 1, obsMaxDirectGain2, 1, 1, 1, 0, 2) : Infinity) / getPerkCost("Observation", 2);
	} else {
		MODULES.surky.perks.Observation.efficiency2 = 0;
	}

	// Masterfulness:
	//   Simple: +1 greed +1 tenacity. The extremely harsh cost scaling means it's not very pointful to consider other than a default tenacity time.
	MODULES.surky.perks.Masterfulness.efficiency = getLogWeightedValue(MODULES.surky.perks.Tenacity.effect, 1, 1, greedGain, greedGain, 1) / getPerkCost("Masterfulness", 1);

	// Smithology
	//   Grow attack and health based on # of smithies (1.25x base, +0.01 per level in Smithology, raised to the # of smithies)
	var smithobase = 1 + 1 / (125 + MODULES.surky.perks.Smithology.level);
	var smithogain = Math.pow(smithobase, MODULES.surky.props.smithyCount);
	MODULES.surky.perks.Smithology.efficiency = getLogWeightedValue(smithogain, smithogain, 1, 1, 1) / getPerkCost("Smithology", 1);

	// Fuck it.
	// Agility: 5% atk, 5% hp, 5% resources, 5% radon per level. No this isn't accurate. No I don't care.
	MODULES.surky.perks.Agility.efficiency = getLogWeightedValue(1.05, 1.05, 1, 1.05, 1.05, 1) / getPerkCost("Agility", 1);
	// Range: 1% atk per level. Not accurate, don't care.
	MODULES.surky.perks.Range.efficiency = getLogWeightedValue(1.01, 1, 1, 1, 1, 1) / getPerkCost("Range", 1);
	// Hunger: 3% atk per level. Not accurate, don't care.
	MODULES.surky.perks.Hunger.efficiency = getLogWeightedValue(1.03, 1, 1, 1, 1, 1) / getPerkCost("Hunger", 1);
}

// zero out perk inputs and autobuy
function clearAndAutobuyPerks() {
	if (MODULES.surky.props.perksRadon > 0) {
		MODULES.surky.perks.Pheromones.optimize = (game.stats.highestRadLevel.valueTotal() >= 60) && (MODULES.surky.props.specialChallenge !== 'trappa');
		var origCarp = game.portal.Carpentry.radLevel;
		var origExpand = game.portal.Expansion.radLevel;

		if (challengeActive('Downsize') && MODULES.surky.props.specialChallenge === 'combat') {
			// impractical to know actual housing in downsize, just don't reduce Carp or Expansion level
			MODULES.surky.perks.Carpentry.level = origCarp;
			MODULES.surky.perks.Expansion.level = origExpand;
		} else if (MODULES.surky.props.specialChallenge === 'combat' || MODULES.surky.props.specialChallenge === 'combatRadon') {
			game.unlocks.impCount.Tauntimp = game.unlocks.impCount.Tauntimp;
			// must have enough carp to sustain current coordination - or very conservatively for trappa, 10 more coords after final army send (should still be negligible Rn spent on carp)
			var wantedArmySize = (challengeActive('Trappapalooza') ? Math.pow(1.25, 10) : 1) * game.resources.trimps.maxSoldiers;
			var tauntBase = 1.003 + 0.0001 * origExpand;
			var tauntMult = game.global.expandingTauntimp ? Math.pow(tauntBase, game.unlocks.impCount.Tauntimp) : 1;
			var carpWanted = Math.max(0, Math.ceil(Math.log(2.4 * wantedArmySize / (tauntMult * ((game.resources.trimps.max * game.resources.trimps.maxMod) * autoBattle.bonuses.Scaffolding.getMult()))) / Math.log(1.1)));
		}
		initialLoad(true);
		//Setting this here since initialLoad clears perk levels and we need to know the minimum carp level we can have
		MODULES.surky.perks.Carpentry.level = carpWanted;
		// get correct available radon for cleared perks
		// for max carp, just max out carp!
		if (MODULES.surky.props.specialChallenge === 'trappacarp') {
			MODULES.surky.perks.Carpentry.level = 0;
			while (buyPerk('Carpentry', 1));
			evaluatePerks();
			allocateSurky();
		} else {
			autobuyPerks();
		}
	}
}

// autobuy from current input perk levels
function autobuyPerks() {
	var eList = [];
	var pList = [];
	efficiencyFlag(eList, pList);
	evaluatePerks();
	// this function is not used for max pop starting spec for trappa
	if (MODULES.surky.props.specialChallenge === 'trappacarp' && game.global.canRespecPerks) {
		clearAndAutobuyPerks();
		return;
	}
	// optimize Bait for Trappa
	MODULES.surky.perks.Bait.optimize = (MODULES.surky.props.specialChallenge === 'trappa' || MODULES.surky.props.specialChallenge === 'combat' && challengeActive('Trappapalooza'));
	MODULES.surky.perks.Pheromones.optimize = (game.stats.highestRadLevel.valueTotal() >= 60) && (MODULES.surky.props.specialChallenge !== 'trappa') && !(MODULES.surky.props.specialChallenge === 'combat' && challengeActive('Trappapalooza'));
	if (MODULES.surky.props.specialChallenge === 'trappa' || MODULES.surky.props.specialChallenge === 'combat' && challengeActive('Trappapalooza')) {
		var maxCarpLevels = Math.log(MODULES.surky.props.perksRadon / MODULES.surky.perks.Carpentry.priceBase * (MODULES.surky.perks.Carpentry.priceFact - 1) + 1) / Math.log(MODULES.surky.perks.Carpentry.priceFact);
		MODULES.surky.props.trappaStartPop = 10 * Math.pow(1.1, maxCarpLevels) * autoBattle.bonuses.Scaffolding.getMult();
	}
	// optimize Trumps for Downsize
	MODULES.surky.perks.Trumps.optimize = (MODULES.surky.props.specialChallenge === 'downsize');
	var bestPerk = efficiencyFlag(eList, pList);
	while (bestPerk !== "") {
		var bestName = bestPerk;
		var bestObj = MODULES.surky.perks[bestName];
		var buy2 = bestObj.hasOwnProperty("efficiency2") && bestObj.efficiency2 > bestObj.efficiency;
		if (buy2) {
			if (!buyPerk(bestName, 2) || bestObj.efficiency2 < 0) {
				throw ("ERROR: a perk was flagged to buy 2 levels at once, but it was unaffordable or had a negative efficiency: " + bestName);
			}
		} else if (!buyPerk(bestName) || bestObj.efficiency < 0) {
			throw ("ERROR: a maxed, unaffordable, or inefficient perk was flagged as best: " + bestName);
			return;
		}
		MODULES.surky.perks[bestName].level = bestObj.level;
		getPerkEfficiencies();
		bestPerk = efficiencyFlag(eList, pList);
	}
	// use trumps as dump perk
	if (!(MODULES.surky.props.specialChallenge === 'combat') && !(MODULES.surky.props.specialChallenge === 'combatRadon')) {
		while (buyPerk("Trumps", 1));
	}
	// and Pheromones! (but not in Trappa, for minimum confusion, and not before Trappa unlock)
	if (MODULES.surky.props.specialChallenge !== 'trappa' && !(MODULES.surky.props.specialChallenge === 'combat' && challengeActive('Trappapalooza'))) {
		while (buyPerk("Pheromones", 1));
	}
	// secret setting to dump remaining Rn into bait for feeeeeee
	while (buyPerk("Bait", 1));

	evaluatePerks();
	allocateSurky();
	console.log("Surky - Total Radon for perks: " + prettify(MODULES.surky.props.perksRadon) + ", Total Radon Spent: " + prettify(MODULES.surky.props.radonSpent), 'portal');
}

if (typeof (autoTrimpSettings) === 'undefined') {
	//On swapping portla universes load either Perky or Surky.
	var originalswapPortalUniverse = swapPortalUniverse;
	swapPortalUniverse = function () {
		originalswapPortalUniverse(...arguments)
		try {
			MODULES.autoPerks.displayGUI(portalUniverse);
		}
		catch (e) { console.log("Universe Swap - Failed to swap UI: " + e, "other") }
	}
}

//If using standalone version then when loading Surky file also load CSS & Perky then load portal UI.
//After initial load everything should work perfectly.
if (typeof (autoTrimpSettings) === 'undefined' || (typeof (autoTrimpSettings) !== 'undefined' && typeof (autoTrimpSettings.ATversion) !== 'undefined' && !autoTrimpSettings.ATversion.includes('SadAugust'))) {
	//Load CSS so that the UI is visible
	var linkStylesheet = document.createElement("link");
	linkStylesheet.rel = "stylesheet";
	linkStylesheet.type = "text/css";
	linkStylesheet.href = "https://sadaugust.github.io/AutoTrimps/tabsStandalone.css";
	document.head.appendChild(linkStylesheet);

	//Load Perky
	var script = document.createElement('script');
	script.id = "AutoTrimps-SadAugust_Perky";
	script.src = "https://sadaugust.github.io/AutoTrimps/modules/perky.js";
	script.setAttribute('crossorigin', 'anonymous');
	document.head.appendChild(script);

	//Load the portal UI
	MODULES.autoPerks.displayGUI(portalUniverse);
	//Send chat msg to notify user that this has loaded.
	console.log("Surky & Perky loaded.")

}