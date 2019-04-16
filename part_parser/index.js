var fs = require("fs");
var pathUtil = require("path");
var partParser = require("./part_parser");
var jsonPath = require("../lib/jsonpath").jsonPath;

var partDir = process.argv[process.argv.length-1];

var TYPES = {
	UNKNOWN:0,
	LFO_ENGINE:1,
	LFO_TANK:2,
	BOOSTER:3,
	DECOUPLER:4,
	DUCT:5,
	BRANCH:6,
	LF_TANK:21,
	O_TANK:22,
	ADAPTER:23
};

var RESOURCE_MASS = {
	"LiquidFuel" : 0.005,
	"Oxidizer" : 0.005,
	"SolidFuel" : 0.0075,
	"MonoPropellant" : 0.004
};

var SIZES = {
    "size0" : 0.0,
    "size1" : 1.0,
    "size1p5" : 1.5,
    "size2" : 2.0,
    "size3" : 3.0,
    "size4" : 4.0
}

var localization_file;
function findFiles(path) {
	var files = [];
	var ls = fs.readdirSync(path);
	for (var x = 0, xl = ls.length; x < xl; ++x) {
		var file = pathUtil.join(path,ls[x]);
		if (fs.statSync(file).isDirectory() && (ls[x] != "zDeprecated")) {
			files = files.concat(findFiles(file));
		} else if (file.slice(-14) == "dictionary.cfg") {
			localization_file = file;
		} else if (file.slice(-4) === ".cfg") {
			files.push(file);
		}
	}
	return files;
}

function parseFile(file) {
	var content = fs.readFileSync(file, {encoding:"utf8"});
	var partTree;
	try {
		partTree = partParser.parse(content);
		if (partTree.$garbage && partTree.$garbage.length) {
			console.warn("Garbage found while parsing %s:", file)
			console.warn(partTree.$garbage);
		}
	} catch (e) {
		console.error("Error with " + file, e);
	}
	return partTree;
}

function last(arr, defaultValue) {
	if (arr && arr.length) {
		return arr[arr.length - 1] || defaultValue;
	}
	return defaultValue;
}
var files = findFiles(partDir);
var localization = [];
var loc = parseFile(localization_file).﻿Localization[0]['en-us'][0];
if (loc) {
    localization = loc;
}

var results = [];
files.map(parseFile).forEach(function (fileParts) {

	var parts = fileParts.PART;
	if (parts) {
		parts.forEach(function (part) {
		    
			var result = {
			    name : part.title ? (localization[part.title[part.title.length-1]] ? localization[part.title[part.title.length-1]][0] : part.title[part.title.length-1]) : part.name[part.name.length-1], 
				type : "TYPES.UNKNOWN", 
				size : -1,
				cost : part.cost ? parseInt(part.cost[part.cost.length-1]) : 0, 
				mass : part.mass ? parseFloat(part.mass[part.mass.length-1]) : 0
			};
			
			//Determine if part is radially attached
			var radial = false;
			if (part.attachRules) {
				var attachRules = part.attachRules[part.attachRules.length-1].split(/\s*,\s*/);
				if (attachRules[0] === "0" && attachRules[1] === "1") {
					radial = true;
				}
			}
			
			if (part.node_stack_top || part.node_stack_bottom || part.node_attach) {
				var node_stack = (part.node_stack_top || part.node_stack_bottom || part.node_attach)[0].split(/\s*,\s*/);
				result.size = parseFloat(node_stack[6]);
				if (isNaN(result.size)) result.size = (radial ? -1 : 1);  //WATCH: Seems to be a safe assumption

			//	var node_top = [];
			//	var node_bottom = [];
			//	if (part.node_stack_top || part.node_attach) node_top = (part.node_stack_top || part.node_attach)[0].split(/\s*,\s*/);
			//	if (part.node_stack_bottom || part.node_attach) node_bottom = (part.node_stack_bottom || part.node_attach)[0].split(/\s*,\s*/);
			//	var size_top = parseFloat(node_top[6]);
			//	var size_bottom = parseFloat(node_bottom[6]);
//
//				result.sizeA = isNaN(size_bottom) ? (radial ? -1 : size_top) : size_bottom;
//				result.sizeB = isNaN(size_top) ? (radial ? -1 : size_bottom) : size_top;
			}
			
			//LF/O Engine properties
			var moduleEngines = jsonPath(part, "$.MODULE[?(@.name[-1:]=='ModuleEngines'||@.name[-1:]=='ModuleEnginesFX'&&@.PROPELLANT[*].name[-1:]=='Oxidizer'||@.PROPELLANT[*].name[-1:]=='SolidFuel')]");
			if (moduleEngines) {
				console.assert(moduleEngines.length === 1, "Part has one and only one engine", part);
				moduleEngines = moduleEngines[0];
				
				result.type = "TYPES.LFO_ENGINE";  //WATCH: Might be a booster. If so, gets fixed in Tank section
				result.thrust_min = parseFloat(moduleEngines.minThrust[moduleEngines.minThrust.length-1]);
				result.thrust_max = parseFloat(moduleEngines.maxThrust[moduleEngines.maxThrust.length-1]);
				result.throttleable = (last(moduleEngines.throttleLocked, "").toLowerCase() !== "true" && (!result.thrust_min || last(moduleEngines.allowShutdown,  "").toLowerCase() !== "false"));
				
				var isps = moduleEngines.atmosphereCurve[moduleEngines.atmosphereCurve.length-1].key;
				isps.forEach(function (isp) {
					var split = /^([01]) (\d+)$/.exec(isp);
					if (split) {
						if (split[1] === "0") {
							result.isp_vac = parseInt(split[2]);
						} else if (split[1] === "1") {
							result.isp_atm = parseInt(split[2]);
						} else {
							console.warn("Unknown ISP syntax", isp);
						}
					}
				});
				
				//Change thrust to use vacuum again
				//FIXME: Change thrust calculations in kspcalc instead
				result.thrust_atm = parseFloat(((result.thrust_max / result.isp_vac) * result.isp_atm).toFixed(15));
				result.thrust_vac = result.thrust_max;
			}
			
			var moduleGimbal = jsonPath(part, "$.MODULE[?(@.name[-1:]=='ModuleGimbal')]");
			if (moduleGimbal) {
				//console.assert(moduleGimbal.length === 1, "Part has one and only one gimbal", part);
				moduleGimbal = moduleGimbal[0];
				
				result.gimbal = parseFloat(moduleGimbal.gimbalRange[moduleGimbal.gimbalRange.length-1]);
			}
			
			//Tank properties
			var resources = part.RESOURCE;
			if (resources) {
				resources.forEach(function (resource) {
					var name = resource.name[resource.name.length-1];
					var amount = parseFloat(resource.maxAmount[resource.maxAmount.length-1]);
					
					if (RESOURCE_MASS[name]) {
						if (!result.mass_fuel) result.mass_fuel = 0;
						
						switch(result.type) {
						case "TYPES.LFO_ENGINE":
							if (RESOURCE_MASS[name]) result.type = "TYPES.BOOSTER";
							break;
						
						case "TYPES.BOOSTER":
						case "TYPES.LFO_TANK":
							break;
							
						case "TYPES.LF_TANK":
							if (name === "Oxidizer") result.type = "TYPES.LFO_TANK";
							break;
							
						case "TYPES.O_TANK":
							if (name === "LiquidFuel") result.type = "TYPES.LFO_TANK";
							break;
							
						default:
							if (name === "LiquidFuel") {
								result.type = "TYPES.LF_TANK";
							} else if (name === "Oxidizer") {
								result.type = "TYPES.O_TANK";
							}
						}
						
						result.mass_fuel += (RESOURCE_MASS[name] || 0) * amount;
					}
				});
			}

			
			//Decoupler properties
			var moduleDecoupler = jsonPath(part, "$.MODULE[?(@.name[-1:]=='ModuleDecouple'||@.name[-1:]=='ModuleAnchoredDecoupler')]");
			if (moduleDecoupler && moduleDecoupler.length === 1) {
				moduleDecoupler = moduleDecoupler[0];
				
				if (result.type === "TYPES.UNKNOWN") result.type = "TYPES.DECOUPLER";
				result.ejection_force = parseInt(moduleDecoupler.ejectionForce[moduleDecoupler.ejectionForce.length-1]);
				result.is_engine_plate = moduleDecoupler.isEnginePlate == "true" ? true : false;
			}
			
			//Find largest branch number
			var branchNumber = 0;
			var branchName;
			for (var key in part) {
				var match = /^node_stack_bottom(\d+)$/.exec(key);
				if (match && parseInt(match[1], 10) > branchNumber) {
					branchNumber = parseInt(match[1], 10);
					branchName = key;
				}
			}
			if (branchNumber > 1) {
				if (result.type === "TYPES.UNKNOWN") result.type = "TYPES.BRANCH";
				result.sizeA = result.size;
				result.sizeB = parseFloat(part[branchName][0].split(/\s*,\s*/)[6]);
				if (isNaN(result.sizeB)) result.sizeB = 1;  //WATCH: Seems to be a safe assumption
				result.multiplier = branchNumber;
			}
			
			//Determine if this must be the last part in the stack
			if (!part.node_stack_bottom && !part.node_stack_bottom01 && !part.node_stack_bottom1) {
				result.last = true;
			}
			
			if (radial) {
				result.radial = true;
				result.size = -1;
			}
			
			if (part.bulkheadProfiles && (result.type == "TYPES.LFO_TANK" || result.type == "TYPES.DECOUPLER" || result.type == "TYPES.UNKNOWN"))
			{
			    //console.log ("%s --> %s", part.name, part.bulkheadProfiles[0].split(/\s*,\s*/));
			    var bPs = part.bulkheadProfiles[0].split(/\s*,\s*/);
			    if (bPs[bPs.length - 1] == "srf") bPs.pop();
			    if (bPs.length == 2)
			    {
				console.assert(typeof SIZES[bPs[0]] != 'undefined', "Unknown bulkheadProfies size", bPs[0]);
				console.assert(typeof SIZES[bPs[1]] != 'undefined', "Unknown bulkheadProfies size", bPs[1]);

				result.size = result.sizeA = Math.max(SIZES[bPs[0]], SIZES[bPs[1]]);
				result.sizeB = Math.min(SIZES[bPs[0]], SIZES[bPs[1]]);
				//console.log("%d %d %s", result.sizeA, result.sizeB, result.type);
				result.type = "TYPES.ADAPTER";
			    }
			    else if ((bPs.length == 1) && (bPs[0] == "size1p5"))
			    {
				result.size = 1.5;
			    }
			}

			//Remove useless parts
			if (result.name === "Launch Escape System" || /Mk[123][\s-]|Cupola|C7 Brand|Service Bay|Structural Tube|Reentry Module|Heat Shield/.test(result.name)) result.type = "TYPES.UNKNOWN";
			
			results.push(result);
		});
	}
});

function partSort(a, b) {
	return b.size - a.size || b.mass - a.mass;
}

function partFilterByType(type, part) {
	return part.type === type;
}

function prettyPrint(parts) {
	return JSON.stringify(parts.sort(partSort)).replace(/"(TYPES\.[A-Z_]+)"/g, "$1").replace(/\},\{/g, "},\n{");
}

console.log("LF/O Engines:");
console.log(prettyPrint(results.filter(partFilterByType.bind(this,"TYPES.LFO_ENGINE"))));
console.log("LF/O Tanks:");
console.log(prettyPrint(results.filter(partFilterByType.bind(this,"TYPES.LFO_TANK"))));
console.log("Boosters:");
console.log(prettyPrint(results.filter(partFilterByType.bind(this,"TYPES.BOOSTER"))));
console.log("Decouplers:");
console.log(prettyPrint(results.filter(partFilterByType.bind(this,"TYPES.DECOUPLER"))));
console.log("Branches:");
console.log(prettyPrint(results.filter(partFilterByType.bind(this,"TYPES.BRANCH"))));
console.log("Adapters:");
console.log(prettyPrint(results.filter(partFilterByType.bind(this,"TYPES.ADAPTER"))));
