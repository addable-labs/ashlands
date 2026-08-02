/**
* @license
* Copyright 2010-2026 Three.js Authors
* SPDX-License-Identifier: MIT
*/
/**
* The texture will simply repeat to infinity.
*
* @type {number}
* @constant
*/
const RepeatWrapping = 1e3;
/**
* The last pixel of the texture stretches to the edge of the mesh.
*
* @type {number}
* @constant
*/
const ClampToEdgeWrapping = 1001;
/**
* The texture will repeats to infinity, mirroring on each repeat.
*
* @type {number}
* @constant
*/
const MirroredRepeatWrapping = 1002;
/**
* Returns the value of the texture element that is nearest (in Manhattan distance)
* to the specified texture coordinates.
*
* @type {number}
* @constant
*/
const NearestFilter = 1003;
/**
* Returns the weighted average of the four texture elements that are closest to the specified
* texture coordinates, and can include items wrapped or repeated from other parts of a texture,
* depending on the values of `wrapS` and `wrapT`, and on the exact mapping.
*
* @type {number}
* @constant
*/
const LinearFilter = 1006;
/**
* Chooses the two mipmaps that most closely match the size of the pixel being textured and uses
* the `LinearFilter` criterion to produce a texture value from each mipmap. The final texture value
* is a weighted average of those two values.
*
* @type {number}
* @constant
*/
const LinearMipmapLinearFilter = 1008;
/**
* An unsigned byte data type for textures.
*
* @type {number}
* @constant
*/
const UnsignedByteType = 1009;
/**
* A float data type for textures.
*
* @type {number}
* @constant
*/
const FloatType = 1015;
/**
* Reads the red, green, blue and alpha components.
*
* @type {number}
* @constant
*/
const RGBAFormat = 1023;
/**
* Discrete interpolation mode for keyframe tracks.
*
* @type {number}
* @constant
*/
const InterpolateDiscrete = 2300;
/**
* Linear interpolation mode for keyframe tracks.
*
* @type {number}
* @constant
*/
const InterpolateLinear = 2301;
/**
* Smooth interpolation mode for keyframe tracks.
*
* @type {number}
* @constant
*/
const InterpolateSmooth = 2302;
/**
* Bezier interpolation mode for keyframe tracks.
*
* Uses cubic Bezier curves with explicit 2D control points.
* Requires tangent data to be set on the track.
*
* @type {number}
* @constant
*/
const InterpolateBezier = 2303;
/**
* Zero curvature ending for animations.
*
* @type {number}
* @constant
*/
const ZeroCurvatureEnding = 2400;
/**
* Zero slope ending for animations.
*
* @type {number}
* @constant
*/
const ZeroSlopeEnding = 2401;
/**
* Wrap around ending for animations.
*
* @type {number}
* @constant
*/
const WrapAroundEnding = 2402;
/**
* sRGB color space.
*
* @type {string}
* @constant
*/
const SRGBColorSpace = "srgb";
/**
* sRGB-linear color space.
*
* @type {string}
* @constant
*/
const LinearSRGBColorSpace = "srgb-linear";
/**
* Linear transfer function.
*
* @type {string}
* @constant
*/
const LinearTransfer = "linear";
/**
* sRGB transfer function.
*
* @type {string}
* @constant
*/
const SRGBTransfer = "srgb";
/**
* Keeps the current value.
*
* @type {number}
* @constant
*/
const KeepStencilOp = 7680;
/**
* The contents are intended to be specified once by the application, and used many
* times as the source for drawing and image specification commands.
*
* @type {number}
* @constant
*/
const StaticDrawUsage = 35044;
/**
* WebGL coordinate system.
*
* @type {number}
* @constant
*/
const WebGLCoordinateSystem = 2e3;
/**
* This type represents mouse buttons and interaction types in context of controls.
*
* @typedef {Object} ConstantsMouse
* @property {number} MIDDLE - The left mouse button.
* @property {number} LEFT - The middle mouse button.
* @property {number} RIGHT - The right mouse button.
* @property {number} ROTATE - A rotate interaction.
* @property {number} DOLLY - A dolly interaction.
* @property {number} PAN - A pan interaction.
**/
/**
* This type represents touch interaction types in context of controls.
*
* @typedef {Object} ConstantsTouch
* @property {number} ROTATE - A rotate interaction.
* @property {number} PAN - A pan interaction.
* @property {number} DOLLY_PAN - The dolly-pan interaction.
* @property {number} DOLLY_ROTATE - A dolly-rotate interaction.
**/
/**
* This type represents the different timestamp query types.
*
* @typedef {Object} ConstantsTimestampQuery
* @property {string} COMPUTE - A `compute` timestamp query.
* @property {string} RENDER - A `render` timestamp query.
**/
/**
* Represents the different interpolation sampling types.
*
* @typedef {Object} ConstantsInterpolationSamplingType
* @property {string} PERSPECTIVE - Perspective-correct interpolation.
* @property {string} LINEAR - Linear interpolation.
* @property {string} FLAT - Flat interpolation.
*/
/**
* Represents the different interpolation sampling modes.
*
* @typedef {Object} ConstantsInterpolationSamplingMode
* @property {string} NORMAL - Normal sampling mode.
* @property {string} CENTROID - Centroid sampling mode.
* @property {string} SAMPLE - Sample-specific sampling mode.
* @property {string} FIRST - Flat interpolation using the first vertex.
* @property {string} EITHER - Flat interpolation using either vertex.
*/
/**
* Checks if an array contains values that require Uint32 representation.
*
* This function determines whether the array contains any values >= 65535,
* which would require a Uint32Array rather than a Uint16Array for proper storage.
* The function iterates from the end of the array, assuming larger values are
* typically located at the end.
*
* @private
* @param {Array<number>} array - The array to check.
* @return {boolean} True if the array contains values >= 65535, false otherwise.
*/
function arrayNeedsUint32(array) {
	for (let i = array.length - 1; i >= 0; --i) if (array[i] >= 65535) return true;
	return false;
}
/**
* Returns `true` if the given object is a typed array.
*
* @param {any} array - The object to check.
* @return {boolean} Whether the given object is a typed array.
*/
function isTypedArray(array) {
	return ArrayBuffer.isView(array) && !(array instanceof DataView);
}
/**
* Creates an XHTML element with the specified tag name.
*
* This function uses the XHTML namespace to create DOM elements,
* ensuring proper element creation in XML-based contexts.
*
* @private
* @param {string} name - The tag name of the element to create (e.g., 'canvas', 'div').
* @return {HTMLElement} The created XHTML element.
*/
function createElementNS(name) {
	return document.createElementNS("http://www.w3.org/1999/xhtml", name);
}
/**
* Internal cache for tracking warning messages to prevent duplicate warnings.
*
* @private
* @type {Object<string, boolean>}
*/
const _cache = {};
/**
* Enhances log/warn/error messages related to TSL.
*
* @param {Array<any>} params - The original message parameters.
* @returns {Array<any>} The filtered and enhanced message parameters.
*/
function enhanceLogMessage(params) {
	const message = params[0];
	if (typeof message === "string" && message.startsWith("TSL:")) {
		const stackTrace = params[1];
		if (stackTrace && stackTrace.isStackTrace) params[0] += " " + stackTrace.getLocation();
		else params[1] = "Stack trace not available. Enable \"THREE.Node.captureStackTrace\" to capture stack traces.";
	}
	return params;
}
/**
* Logs a warning message with the 'THREE.' prefix.
*
* If a custom console function is set via setConsoleFunction(), it will be used
* instead of the native console.warn. The first parameter is treated as the
* method name and is automatically prefixed with 'THREE.'.
*
* @param {...any} params - The message components. The first param is used as
*                          the method name and prefixed with 'THREE.'.
*/
function warn(...params) {
	params = enhanceLogMessage(params);
	const message = "THREE." + params.shift();
	{
		const stackTrace = params[0];
		if (stackTrace && stackTrace.isStackTrace) console.warn(stackTrace.getError(message));
		else console.warn(message, ...params);
	}
}
/**
* Logs an error message with the 'THREE.' prefix.
*
* If a custom console function is set via setConsoleFunction(), it will be used
* instead of the native console.error. The first parameter is treated as the
* method name and is automatically prefixed with 'THREE.'.
*
* @param {...any} params - The message components. The first param is used as
*                          the method name and prefixed with 'THREE.'.
*/
function error(...params) {
	params = enhanceLogMessage(params);
	const message = "THREE." + params.shift();
	{
		const stackTrace = params[0];
		if (stackTrace && stackTrace.isStackTrace) console.error(stackTrace.getError(message));
		else console.error(message, ...params);
	}
}
/**
* Logs a warning message only once, preventing duplicate warnings.
*
* This function maintains an internal cache of warning messages and will only
* output each unique warning message once. Useful for warnings that may be
* triggered repeatedly but should only be shown to the user once.
*
* @param {...any} params - The warning message components.
*/
function warnOnce(...params) {
	const message = params.join(" ");
	if (message in _cache) return;
	_cache[message] = true;
	warn(...params);
}
/**
* This modules allows to dispatch event objects on custom JavaScript objects.
*
* Main repository: [eventdispatcher.js](https://github.com/mrdoob/eventdispatcher.js/)
*
* Code Example:
* ```js
* class Car extends EventDispatcher {
* 	start() {
*		this.dispatchEvent( { type: 'start', message: 'vroom vroom!' } );
*	}
*};
*
* // Using events with the custom object
* const car = new Car();
* car.addEventListener( 'start', function ( event ) {
* 	alert( event.message );
* } );
*
* car.start();
* ```
*/
var EventDispatcher = class {
	/**
	* Adds the given event listener to the given event type.
	*
	* @param {string} type - The type of event to listen to.
	* @param {Function} listener - The function that gets called when the event is fired.
	*/
	addEventListener(type, listener) {
		if (this._listeners === void 0) this._listeners = {};
		const listeners = this._listeners;
		if (listeners[type] === void 0) listeners[type] = [];
		if (listeners[type].indexOf(listener) === -1) listeners[type].push(listener);
	}
	/**
	* Returns `true` if the given event listener has been added to the given event type.
	*
	* @param {string} type - The type of event.
	* @param {Function} listener - The listener to check.
	* @return {boolean} Whether the given event listener has been added to the given event type.
	*/
	hasEventListener(type, listener) {
		const listeners = this._listeners;
		if (listeners === void 0) return false;
		return listeners[type] !== void 0 && listeners[type].indexOf(listener) !== -1;
	}
	/**
	* Removes the given event listener from the given event type.
	*
	* @param {string} type - The type of event.
	* @param {Function} listener - The listener to remove.
	*/
	removeEventListener(type, listener) {
		const listeners = this._listeners;
		if (listeners === void 0) return;
		const listenerArray = listeners[type];
		if (listenerArray !== void 0) {
			const index = listenerArray.indexOf(listener);
			if (index !== -1) listenerArray.splice(index, 1);
		}
	}
	/**
	* Dispatches an event object.
	*
	* @param {Object} event - The event that gets fired.
	*/
	dispatchEvent(event) {
		const listeners = this._listeners;
		if (listeners === void 0) return;
		const listenerArray = listeners[event.type];
		if (listenerArray !== void 0) {
			event.target = this;
			const array = listenerArray.slice(0);
			for (let i = 0, l = array.length; i < l; i++) array[i].call(this, event);
			event.target = null;
		}
	}
};
const _lut = [
	"00",
	"01",
	"02",
	"03",
	"04",
	"05",
	"06",
	"07",
	"08",
	"09",
	"0a",
	"0b",
	"0c",
	"0d",
	"0e",
	"0f",
	"10",
	"11",
	"12",
	"13",
	"14",
	"15",
	"16",
	"17",
	"18",
	"19",
	"1a",
	"1b",
	"1c",
	"1d",
	"1e",
	"1f",
	"20",
	"21",
	"22",
	"23",
	"24",
	"25",
	"26",
	"27",
	"28",
	"29",
	"2a",
	"2b",
	"2c",
	"2d",
	"2e",
	"2f",
	"30",
	"31",
	"32",
	"33",
	"34",
	"35",
	"36",
	"37",
	"38",
	"39",
	"3a",
	"3b",
	"3c",
	"3d",
	"3e",
	"3f",
	"40",
	"41",
	"42",
	"43",
	"44",
	"45",
	"46",
	"47",
	"48",
	"49",
	"4a",
	"4b",
	"4c",
	"4d",
	"4e",
	"4f",
	"50",
	"51",
	"52",
	"53",
	"54",
	"55",
	"56",
	"57",
	"58",
	"59",
	"5a",
	"5b",
	"5c",
	"5d",
	"5e",
	"5f",
	"60",
	"61",
	"62",
	"63",
	"64",
	"65",
	"66",
	"67",
	"68",
	"69",
	"6a",
	"6b",
	"6c",
	"6d",
	"6e",
	"6f",
	"70",
	"71",
	"72",
	"73",
	"74",
	"75",
	"76",
	"77",
	"78",
	"79",
	"7a",
	"7b",
	"7c",
	"7d",
	"7e",
	"7f",
	"80",
	"81",
	"82",
	"83",
	"84",
	"85",
	"86",
	"87",
	"88",
	"89",
	"8a",
	"8b",
	"8c",
	"8d",
	"8e",
	"8f",
	"90",
	"91",
	"92",
	"93",
	"94",
	"95",
	"96",
	"97",
	"98",
	"99",
	"9a",
	"9b",
	"9c",
	"9d",
	"9e",
	"9f",
	"a0",
	"a1",
	"a2",
	"a3",
	"a4",
	"a5",
	"a6",
	"a7",
	"a8",
	"a9",
	"aa",
	"ab",
	"ac",
	"ad",
	"ae",
	"af",
	"b0",
	"b1",
	"b2",
	"b3",
	"b4",
	"b5",
	"b6",
	"b7",
	"b8",
	"b9",
	"ba",
	"bb",
	"bc",
	"bd",
	"be",
	"bf",
	"c0",
	"c1",
	"c2",
	"c3",
	"c4",
	"c5",
	"c6",
	"c7",
	"c8",
	"c9",
	"ca",
	"cb",
	"cc",
	"cd",
	"ce",
	"cf",
	"d0",
	"d1",
	"d2",
	"d3",
	"d4",
	"d5",
	"d6",
	"d7",
	"d8",
	"d9",
	"da",
	"db",
	"dc",
	"dd",
	"de",
	"df",
	"e0",
	"e1",
	"e2",
	"e3",
	"e4",
	"e5",
	"e6",
	"e7",
	"e8",
	"e9",
	"ea",
	"eb",
	"ec",
	"ed",
	"ee",
	"ef",
	"f0",
	"f1",
	"f2",
	"f3",
	"f4",
	"f5",
	"f6",
	"f7",
	"f8",
	"f9",
	"fa",
	"fb",
	"fc",
	"fd",
	"fe",
	"ff"
];
Math.PI / 180;
180 / Math.PI;
/**
* Generate a [UUID](https://en.wikipedia.org/wiki/Universally_unique_identifier)
* (universally unique identifier).
*
* @return {string} The UUID.
*/
function generateUUID() {
	const d0 = Math.random() * 4294967295 | 0;
	const d1 = Math.random() * 4294967295 | 0;
	const d2 = Math.random() * 4294967295 | 0;
	const d3 = Math.random() * 4294967295 | 0;
	return (_lut[d0 & 255] + _lut[d0 >> 8 & 255] + _lut[d0 >> 16 & 255] + _lut[d0 >> 24 & 255] + "-" + _lut[d1 & 255] + _lut[d1 >> 8 & 255] + "-" + _lut[d1 >> 16 & 15 | 64] + _lut[d1 >> 24 & 255] + "-" + _lut[d2 & 63 | 128] + _lut[d2 >> 8 & 255] + "-" + _lut[d2 >> 16 & 255] + _lut[d2 >> 24 & 255] + _lut[d3 & 255] + _lut[d3 >> 8 & 255] + _lut[d3 >> 16 & 255] + _lut[d3 >> 24 & 255]).toLowerCase();
}
/**
* Clamps the given value between min and max.
*
* @param {number} value - The value to clamp.
* @param {number} min - The min value.
* @param {number} max - The max value.
* @return {number} The clamped value.
*/
function clamp$1(value, min, max) {
	return Math.max(min, Math.min(max, value));
}
/**
* Computes the Euclidean modulo of the given parameters that
* is `( ( n % m ) + m ) % m`.
*
* @param {number} n - The first parameter.
* @param {number} m - The second parameter.
* @return {number} The Euclidean modulo.
*/
function euclideanModulo(n, m) {
	return (n % m + m) % m;
}
/**
* Returns a value linearly interpolated from two known points based on the given interval -
* `t = 0` will return `x` and `t = 1` will return `y`.
*
* @param {number} x - The start point
* @param {number} y - The end point.
* @param {number} t - The interpolation factor in the closed interval `[0, 1]`.
* @return {number} The interpolated value.
*/
function lerp(x, y, t) {
	return (1 - t) * x + t * y;
}
/**
* Denormalizes the given value according to the given typed array.
*
* @param {number} value - The value to denormalize.
* @param {TypedArray} array - The typed array that defines the data type of the value.
* @return {number} The denormalize (float) value in the range `[0,1]`.
*/
function denormalize(value, array) {
	switch (array.constructor) {
		case Float32Array: return value;
		case Uint32Array: return value / 4294967295;
		case Uint16Array: return value / 65535;
		case Uint8Array: return value / 255;
		case Int32Array: return Math.max(value / 2147483647, -1);
		case Int16Array: return Math.max(value / 32767, -1);
		case Int8Array: return Math.max(value / 127, -1);
		default: throw new Error("THREE.MathUtils: Invalid component type.");
	}
}
/**
* Normalizes the given value according to the given typed array.
*
* @param {number} value - The float value in the range `[0,1]` to normalize.
* @param {TypedArray} array - The typed array that defines the data type of the value.
* @return {number} The normalize value.
*/
function normalize(value, array) {
	switch (array.constructor) {
		case Float32Array: return value;
		case Uint32Array: return Math.round(value * 4294967295);
		case Uint16Array: return Math.round(value * 65535);
		case Uint8Array: return Math.round(value * 255);
		case Int32Array: return Math.round(value * 2147483647);
		case Int16Array: return Math.round(value * 32767);
		case Int8Array: return Math.round(value * 127);
		default: throw new Error("THREE.MathUtils: Invalid component type.");
	}
}
/**
* Class representing a 2D vector. A 2D vector is an ordered pair of numbers
* (labeled x and y), which can be used to represent a number of things, such as:
*
* - A point in 2D space (i.e. a position on a plane).
* - A direction and length across a plane. In three.js the length will
* always be the Euclidean distance(straight-line distance) from `(0, 0)` to `(x, y)`
* and the direction is also measured from `(0, 0)` towards `(x, y)`.
* - Any arbitrary ordered pair of numbers.
*
* There are other things a 2D vector can be used to represent, such as
* momentum vectors, complex numbers and so on, however these are the most
* common uses in three.js.
*
* Iterating through a vector instance will yield its components `(x, y)` in
* the corresponding order.
* ```js
* const a = new THREE.Vector2( 0, 1 );
*
* //no arguments; will be initialised to (0, 0)
* const b = new THREE.Vector2( );
*
* const d = a.distanceTo( b );
* ```
*/
var Vector2 = class Vector2 {
	static {
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		Vector2.prototype.isVector2 = true;
	}
	/**
	* Constructs a new 2D vector.
	*
	* @param {number} [x=0] - The x value of this vector.
	* @param {number} [y=0] - The y value of this vector.
	*/
	constructor(x = 0, y = 0) {
		/**
		* The x value of this vector.
		*
		* @type {number}
		*/
		this.x = x;
		/**
		* The y value of this vector.
		*
		* @type {number}
		*/
		this.y = y;
	}
	/**
	* Alias for {@link Vector2#x}.
	*
	* @type {number}
	*/
	get width() {
		return this.x;
	}
	set width(value) {
		this.x = value;
	}
	/**
	* Alias for {@link Vector2#y}.
	*
	* @type {number}
	*/
	get height() {
		return this.y;
	}
	set height(value) {
		this.y = value;
	}
	/**
	* Sets the vector components.
	*
	* @param {number} x - The value of the x component.
	* @param {number} y - The value of the y component.
	* @return {Vector2} A reference to this vector.
	*/
	set(x, y) {
		this.x = x;
		this.y = y;
		return this;
	}
	/**
	* Sets the vector components to the same value.
	*
	* @param {number} scalar - The value to set for all vector components.
	* @return {Vector2} A reference to this vector.
	*/
	setScalar(scalar) {
		this.x = scalar;
		this.y = scalar;
		return this;
	}
	/**
	* Sets the vector's x component to the given value
	*
	* @param {number} x - The value to set.
	* @return {Vector2} A reference to this vector.
	*/
	setX(x) {
		this.x = x;
		return this;
	}
	/**
	* Sets the vector's y component to the given value
	*
	* @param {number} y - The value to set.
	* @return {Vector2} A reference to this vector.
	*/
	setY(y) {
		this.y = y;
		return this;
	}
	/**
	* Allows to set a vector component with an index.
	*
	* @param {number} index - The component index. `0` equals to x, `1` equals to y.
	* @param {number} value - The value to set.
	* @return {Vector2} A reference to this vector.
	*/
	setComponent(index, value) {
		switch (index) {
			case 0:
				this.x = value;
				break;
			case 1:
				this.y = value;
				break;
			default: throw new Error("THREE.Vector2: index is out of range: " + index);
		}
		return this;
	}
	/**
	* Returns the value of the vector component which matches the given index.
	*
	* @param {number} index - The component index. `0` equals to x, `1` equals to y.
	* @return {number} A vector component value.
	*/
	getComponent(index) {
		switch (index) {
			case 0: return this.x;
			case 1: return this.y;
			default: throw new Error("THREE.Vector2: index is out of range: " + index);
		}
	}
	/**
	* Returns a new vector with copied values from this instance.
	*
	* @return {Vector2} A clone of this instance.
	*/
	clone() {
		return new this.constructor(this.x, this.y);
	}
	/**
	* Copies the values of the given vector to this instance.
	*
	* @param {Vector2} v - The vector to copy.
	* @return {Vector2} A reference to this vector.
	*/
	copy(v) {
		this.x = v.x;
		this.y = v.y;
		return this;
	}
	/**
	* Adds the given vector to this instance.
	*
	* @param {Vector2} v - The vector to add.
	* @return {Vector2} A reference to this vector.
	*/
	add(v) {
		this.x += v.x;
		this.y += v.y;
		return this;
	}
	/**
	* Adds the given scalar value to all components of this instance.
	*
	* @param {number} s - The scalar to add.
	* @return {Vector2} A reference to this vector.
	*/
	addScalar(s) {
		this.x += s;
		this.y += s;
		return this;
	}
	/**
	* Adds the given vectors and stores the result in this instance.
	*
	* @param {Vector2} a - The first vector.
	* @param {Vector2} b - The second vector.
	* @return {Vector2} A reference to this vector.
	*/
	addVectors(a, b) {
		this.x = a.x + b.x;
		this.y = a.y + b.y;
		return this;
	}
	/**
	* Adds the given vector scaled by the given factor to this instance.
	*
	* @param {Vector2} v - The vector.
	* @param {number} s - The factor that scales `v`.
	* @return {Vector2} A reference to this vector.
	*/
	addScaledVector(v, s) {
		this.x += v.x * s;
		this.y += v.y * s;
		return this;
	}
	/**
	* Subtracts the given vector from this instance.
	*
	* @param {Vector2} v - The vector to subtract.
	* @return {Vector2} A reference to this vector.
	*/
	sub(v) {
		this.x -= v.x;
		this.y -= v.y;
		return this;
	}
	/**
	* Subtracts the given scalar value from all components of this instance.
	*
	* @param {number} s - The scalar to subtract.
	* @return {Vector2} A reference to this vector.
	*/
	subScalar(s) {
		this.x -= s;
		this.y -= s;
		return this;
	}
	/**
	* Subtracts the given vectors and stores the result in this instance.
	*
	* @param {Vector2} a - The first vector.
	* @param {Vector2} b - The second vector.
	* @return {Vector2} A reference to this vector.
	*/
	subVectors(a, b) {
		this.x = a.x - b.x;
		this.y = a.y - b.y;
		return this;
	}
	/**
	* Multiplies the given vector with this instance.
	*
	* @param {Vector2} v - The vector to multiply.
	* @return {Vector2} A reference to this vector.
	*/
	multiply(v) {
		this.x *= v.x;
		this.y *= v.y;
		return this;
	}
	/**
	* Multiplies the given scalar value with all components of this instance.
	*
	* @param {number} scalar - The scalar to multiply.
	* @return {Vector2} A reference to this vector.
	*/
	multiplyScalar(scalar) {
		this.x *= scalar;
		this.y *= scalar;
		return this;
	}
	/**
	* Divides this instance by the given vector.
	*
	* @param {Vector2} v - The vector to divide.
	* @return {Vector2} A reference to this vector.
	*/
	divide(v) {
		this.x /= v.x;
		this.y /= v.y;
		return this;
	}
	/**
	* Divides this vector by the given scalar.
	*
	* @param {number} scalar - The scalar to divide.
	* @return {Vector2} A reference to this vector.
	*/
	divideScalar(scalar) {
		return this.multiplyScalar(1 / scalar);
	}
	/**
	* Multiplies this vector (with an implicit 1 as the 3rd component) by
	* the given 3x3 matrix.
	*
	* @param {Matrix3} m - The matrix to apply.
	* @return {Vector2} A reference to this vector.
	*/
	applyMatrix3(m) {
		const x = this.x, y = this.y;
		const e = m.elements;
		this.x = e[0] * x + e[3] * y + e[6];
		this.y = e[1] * x + e[4] * y + e[7];
		return this;
	}
	/**
	* If this vector's x or y value is greater than the given vector's x or y
	* value, replace that value with the corresponding min value.
	*
	* @param {Vector2} v - The vector.
	* @return {Vector2} A reference to this vector.
	*/
	min(v) {
		this.x = Math.min(this.x, v.x);
		this.y = Math.min(this.y, v.y);
		return this;
	}
	/**
	* If this vector's x or y value is less than the given vector's x or y
	* value, replace that value with the corresponding max value.
	*
	* @param {Vector2} v - The vector.
	* @return {Vector2} A reference to this vector.
	*/
	max(v) {
		this.x = Math.max(this.x, v.x);
		this.y = Math.max(this.y, v.y);
		return this;
	}
	/**
	* If this vector's x or y value is greater than the max vector's x or y
	* value, it is replaced by the corresponding value.
	* If this vector's x or y value is less than the min vector's x or y value,
	* it is replaced by the corresponding value.
	*
	* @param {Vector2} min - The minimum x and y values.
	* @param {Vector2} max - The maximum x and y values in the desired range.
	* @return {Vector2} A reference to this vector.
	*/
	clamp(min, max) {
		this.x = clamp$1(this.x, min.x, max.x);
		this.y = clamp$1(this.y, min.y, max.y);
		return this;
	}
	/**
	* If this vector's x or y values are greater than the max value, they are
	* replaced by the max value.
	* If this vector's x or y values are less than the min value, they are
	* replaced by the min value.
	*
	* @param {number} minVal - The minimum value the components will be clamped to.
	* @param {number} maxVal - The maximum value the components will be clamped to.
	* @return {Vector2} A reference to this vector.
	*/
	clampScalar(minVal, maxVal) {
		this.x = clamp$1(this.x, minVal, maxVal);
		this.y = clamp$1(this.y, minVal, maxVal);
		return this;
	}
	/**
	* If this vector's length is greater than the max value, it is replaced by
	* the max value.
	* If this vector's length is less than the min value, it is replaced by the
	* min value.
	*
	* @param {number} min - The minimum value the vector length will be clamped to.
	* @param {number} max - The maximum value the vector length will be clamped to.
	* @return {Vector2} A reference to this vector.
	*/
	clampLength(min, max) {
		const length = this.length();
		return this.divideScalar(length || 1).multiplyScalar(clamp$1(length, min, max));
	}
	/**
	* The components of this vector are rounded down to the nearest integer value.
	*
	* @return {Vector2} A reference to this vector.
	*/
	floor() {
		this.x = Math.floor(this.x);
		this.y = Math.floor(this.y);
		return this;
	}
	/**
	* The components of this vector are rounded up to the nearest integer value.
	*
	* @return {Vector2} A reference to this vector.
	*/
	ceil() {
		this.x = Math.ceil(this.x);
		this.y = Math.ceil(this.y);
		return this;
	}
	/**
	* The components of this vector are rounded to the nearest integer value
	*
	* @return {Vector2} A reference to this vector.
	*/
	round() {
		this.x = Math.round(this.x);
		this.y = Math.round(this.y);
		return this;
	}
	/**
	* The components of this vector are rounded towards zero (up if negative,
	* down if positive) to an integer value.
	*
	* @return {Vector2} A reference to this vector.
	*/
	roundToZero() {
		this.x = Math.trunc(this.x);
		this.y = Math.trunc(this.y);
		return this;
	}
	/**
	* Inverts this vector - i.e. sets x = -x and y = -y.
	*
	* @return {Vector2} A reference to this vector.
	*/
	negate() {
		this.x = -this.x;
		this.y = -this.y;
		return this;
	}
	/**
	* Calculates the dot product of the given vector with this instance.
	*
	* @param {Vector2} v - The vector to compute the dot product with.
	* @return {number} The result of the dot product.
	*/
	dot(v) {
		return this.x * v.x + this.y * v.y;
	}
	/**
	* Calculates the cross product of the given vector with this instance.
	*
	* @param {Vector2} v - The vector to compute the cross product with.
	* @return {number} The result of the cross product.
	*/
	cross(v) {
		return this.x * v.y - this.y * v.x;
	}
	/**
	* Computes the square of the Euclidean length (straight-line length) from
	* (0, 0) to (x, y). If you are comparing the lengths of vectors, you should
	* compare the length squared instead as it is slightly more efficient to calculate.
	*
	* @return {number} The square length of this vector.
	*/
	lengthSq() {
		return this.x * this.x + this.y * this.y;
	}
	/**
	* Computes the  Euclidean length (straight-line length) from (0, 0) to (x, y).
	*
	* @return {number} The length of this vector.
	*/
	length() {
		return Math.sqrt(this.x * this.x + this.y * this.y);
	}
	/**
	* Computes the Manhattan length of this vector.
	*
	* @return {number} The length of this vector.
	*/
	manhattanLength() {
		return Math.abs(this.x) + Math.abs(this.y);
	}
	/**
	* Converts this vector to a unit vector - that is, sets it equal to a vector
	* with the same direction as this one, but with a vector length of `1`.
	*
	* @return {Vector2} A reference to this vector.
	*/
	normalize() {
		return this.divideScalar(this.length() || 1);
	}
	/**
	* Computes the angle in radians of this vector with respect to the positive x-axis.
	*
	* @return {number} The angle in radians.
	*/
	angle() {
		return Math.atan2(-this.y, -this.x) + Math.PI;
	}
	/**
	* Returns the angle between the given vector and this instance in radians.
	*
	* @param {Vector2} v - The vector to compute the angle with.
	* @return {number} The angle in radians.
	*/
	angleTo(v) {
		const denominator = Math.sqrt(this.lengthSq() * v.lengthSq());
		if (denominator === 0) return Math.PI / 2;
		const theta = this.dot(v) / denominator;
		return Math.acos(clamp$1(theta, -1, 1));
	}
	/**
	* Computes the distance from the given vector to this instance.
	*
	* @param {Vector2} v - The vector to compute the distance to.
	* @return {number} The distance.
	*/
	distanceTo(v) {
		return Math.sqrt(this.distanceToSquared(v));
	}
	/**
	* Computes the squared distance from the given vector to this instance.
	* If you are just comparing the distance with another distance, you should compare
	* the distance squared instead as it is slightly more efficient to calculate.
	*
	* @param {Vector2} v - The vector to compute the squared distance to.
	* @return {number} The squared distance.
	*/
	distanceToSquared(v) {
		const dx = this.x - v.x, dy = this.y - v.y;
		return dx * dx + dy * dy;
	}
	/**
	* Computes the Manhattan distance from the given vector to this instance.
	*
	* @param {Vector2} v - The vector to compute the Manhattan distance to.
	* @return {number} The Manhattan distance.
	*/
	manhattanDistanceTo(v) {
		return Math.abs(this.x - v.x) + Math.abs(this.y - v.y);
	}
	/**
	* Sets this vector to a vector with the same direction as this one, but
	* with the specified length.
	*
	* @param {number} length - The new length of this vector.
	* @return {Vector2} A reference to this vector.
	*/
	setLength(length) {
		return this.normalize().multiplyScalar(length);
	}
	/**
	* Linearly interpolates between the given vector and this instance, where
	* alpha is the percent distance along the line - alpha = 0 will be this
	* vector, and alpha = 1 will be the given one.
	*
	* @param {Vector2} v - The vector to interpolate towards.
	* @param {number} alpha - The interpolation factor, typically in the closed interval `[0, 1]`.
	* @return {Vector2} A reference to this vector.
	*/
	lerp(v, alpha) {
		this.x += (v.x - this.x) * alpha;
		this.y += (v.y - this.y) * alpha;
		return this;
	}
	/**
	* Linearly interpolates between the given vectors, where alpha is the percent
	* distance along the line - alpha = 0 will be first vector, and alpha = 1 will
	* be the second one. The result is stored in this instance.
	*
	* @param {Vector2} v1 - The first vector.
	* @param {Vector2} v2 - The second vector.
	* @param {number} alpha - The interpolation factor, typically in the closed interval `[0, 1]`.
	* @return {Vector2} A reference to this vector.
	*/
	lerpVectors(v1, v2, alpha) {
		this.x = v1.x + (v2.x - v1.x) * alpha;
		this.y = v1.y + (v2.y - v1.y) * alpha;
		return this;
	}
	/**
	* Returns `true` if this vector is equal with the given one.
	*
	* @param {Vector2} v - The vector to test for equality.
	* @return {boolean} Whether this vector is equal with the given one.
	*/
	equals(v) {
		return v.x === this.x && v.y === this.y;
	}
	/**
	* Sets this vector's x value to be `array[ offset ]` and y
	* value to be `array[ offset + 1 ]`.
	*
	* @param {Array<number>} array - An array holding the vector component values.
	* @param {number} [offset=0] - The offset into the array.
	* @return {Vector2} A reference to this vector.
	*/
	fromArray(array, offset = 0) {
		this.x = array[offset];
		this.y = array[offset + 1];
		return this;
	}
	/**
	* Writes the components of this vector to the given array. If no array is provided,
	* the method returns a new instance.
	*
	* @param {Array<number>} [array=[]] - The target array holding the vector components.
	* @param {number} [offset=0] - Index of the first element in the array.
	* @return {Array<number>} The vector components.
	*/
	toArray(array = [], offset = 0) {
		array[offset] = this.x;
		array[offset + 1] = this.y;
		return array;
	}
	/**
	* Sets the components of this vector from the given buffer attribute.
	*
	* @param {BufferAttribute} attribute - The buffer attribute holding vector data.
	* @param {number} index - The index into the attribute.
	* @return {Vector2} A reference to this vector.
	*/
	fromBufferAttribute(attribute, index) {
		this.x = attribute.getX(index);
		this.y = attribute.getY(index);
		return this;
	}
	/**
	* Rotates this vector around the given center by the given angle.
	*
	* @param {Vector2} center - The point around which to rotate.
	* @param {number} angle - The angle to rotate, in radians.
	* @return {Vector2} A reference to this vector.
	*/
	rotateAround(center, angle) {
		const c = Math.cos(angle), s = Math.sin(angle);
		const x = this.x - center.x;
		const y = this.y - center.y;
		this.x = x * c - y * s + center.x;
		this.y = x * s + y * c + center.y;
		return this;
	}
	/**
	* Sets each component of this vector to a pseudo-random value between `0` and
	* `1`, excluding `1`.
	*
	* @return {Vector2} A reference to this vector.
	*/
	random() {
		this.x = Math.random();
		this.y = Math.random();
		return this;
	}
	*[Symbol.iterator]() {
		yield this.x;
		yield this.y;
	}
};
/**
* Class for representing a Quaternion. Quaternions are used in three.js to represent rotations.
*
* Iterating through a vector instance will yield its components `(x, y, z, w)` in
* the corresponding order.
*
* Note that three.js expects Quaternions to be normalized.
* ```js
* const quaternion = new THREE.Quaternion();
* quaternion.setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), Math.PI / 2 );
*
* const vector = new THREE.Vector3( 1, 0, 0 );
* vector.applyQuaternion( quaternion );
* ```
*/
var Quaternion = class {
	/**
	* Constructs a new quaternion.
	*
	* @param {number} [x=0] - The x value of this quaternion.
	* @param {number} [y=0] - The y value of this quaternion.
	* @param {number} [z=0] - The z value of this quaternion.
	* @param {number} [w=1] - The w value of this quaternion.
	*/
	constructor(x = 0, y = 0, z = 0, w = 1) {
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isQuaternion = true;
		this._x = x;
		this._y = y;
		this._z = z;
		this._w = w;
	}
	/**
	* Interpolates between two quaternions via SLERP. This implementation assumes the
	* quaternion data are managed in flat arrays.
	*
	* @param {Array<number>} dst - The destination array.
	* @param {number} dstOffset - An offset into the destination array.
	* @param {Array<number>} src0 - The source array of the first quaternion.
	* @param {number} srcOffset0 - An offset into the first source array.
	* @param {Array<number>} src1 -  The source array of the second quaternion.
	* @param {number} srcOffset1 - An offset into the second source array.
	* @param {number} t - The interpolation factor. A value in the range `[0,1]` will interpolate. A value outside the range `[0,1]` will extrapolate.
	* @see {@link Quaternion#slerp}
	*/
	static slerpFlat(dst, dstOffset, src0, srcOffset0, src1, srcOffset1, t) {
		let x0 = src0[srcOffset0 + 0], y0 = src0[srcOffset0 + 1], z0 = src0[srcOffset0 + 2], w0 = src0[srcOffset0 + 3];
		let x1 = src1[srcOffset1 + 0], y1 = src1[srcOffset1 + 1], z1 = src1[srcOffset1 + 2], w1 = src1[srcOffset1 + 3];
		if (w0 !== w1 || x0 !== x1 || y0 !== y1 || z0 !== z1) {
			let dot = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;
			if (dot < 0) {
				x1 = -x1;
				y1 = -y1;
				z1 = -z1;
				w1 = -w1;
				dot = -dot;
			}
			let s = 1 - t;
			if (dot < .9995) {
				const theta = Math.acos(dot);
				const sin = Math.sin(theta);
				s = Math.sin(s * theta) / sin;
				t = Math.sin(t * theta) / sin;
				x0 = x0 * s + x1 * t;
				y0 = y0 * s + y1 * t;
				z0 = z0 * s + z1 * t;
				w0 = w0 * s + w1 * t;
			} else {
				x0 = x0 * s + x1 * t;
				y0 = y0 * s + y1 * t;
				z0 = z0 * s + z1 * t;
				w0 = w0 * s + w1 * t;
				const f = 1 / Math.sqrt(x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0);
				x0 *= f;
				y0 *= f;
				z0 *= f;
				w0 *= f;
			}
		}
		dst[dstOffset] = x0;
		dst[dstOffset + 1] = y0;
		dst[dstOffset + 2] = z0;
		dst[dstOffset + 3] = w0;
	}
	/**
	* Multiplies two quaternions. This implementation assumes the quaternion data are managed
	* in flat arrays.
	*
	* @param {Array<number>} dst - The destination array.
	* @param {number} dstOffset - An offset into the destination array.
	* @param {Array<number>} src0 - The source array of the first quaternion.
	* @param {number} srcOffset0 - An offset into the first source array.
	* @param {Array<number>} src1 -  The source array of the second quaternion.
	* @param {number} srcOffset1 - An offset into the second source array.
	* @return {Array<number>} The destination array.
	* @see {@link Quaternion#multiplyQuaternions}.
	*/
	static multiplyQuaternionsFlat(dst, dstOffset, src0, srcOffset0, src1, srcOffset1) {
		const x0 = src0[srcOffset0];
		const y0 = src0[srcOffset0 + 1];
		const z0 = src0[srcOffset0 + 2];
		const w0 = src0[srcOffset0 + 3];
		const x1 = src1[srcOffset1];
		const y1 = src1[srcOffset1 + 1];
		const z1 = src1[srcOffset1 + 2];
		const w1 = src1[srcOffset1 + 3];
		dst[dstOffset] = x0 * w1 + w0 * x1 + y0 * z1 - z0 * y1;
		dst[dstOffset + 1] = y0 * w1 + w0 * y1 + z0 * x1 - x0 * z1;
		dst[dstOffset + 2] = z0 * w1 + w0 * z1 + x0 * y1 - y0 * x1;
		dst[dstOffset + 3] = w0 * w1 - x0 * x1 - y0 * y1 - z0 * z1;
		return dst;
	}
	/**
	* The x value of this quaternion.
	*
	* @type {number}
	* @default 0
	*/
	get x() {
		return this._x;
	}
	set x(value) {
		this._x = value;
		this._onChangeCallback();
	}
	/**
	* The y value of this quaternion.
	*
	* @type {number}
	* @default 0
	*/
	get y() {
		return this._y;
	}
	set y(value) {
		this._y = value;
		this._onChangeCallback();
	}
	/**
	* The z value of this quaternion.
	*
	* @type {number}
	* @default 0
	*/
	get z() {
		return this._z;
	}
	set z(value) {
		this._z = value;
		this._onChangeCallback();
	}
	/**
	* The w value of this quaternion.
	*
	* @type {number}
	* @default 1
	*/
	get w() {
		return this._w;
	}
	set w(value) {
		this._w = value;
		this._onChangeCallback();
	}
	/**
	* Sets the quaternion components.
	*
	* @param {number} x - The x value of this quaternion.
	* @param {number} y - The y value of this quaternion.
	* @param {number} z - The z value of this quaternion.
	* @param {number} w - The w value of this quaternion.
	* @return {Quaternion} A reference to this quaternion.
	*/
	set(x, y, z, w) {
		this._x = x;
		this._y = y;
		this._z = z;
		this._w = w;
		this._onChangeCallback();
		return this;
	}
	/**
	* Returns a new quaternion with copied values from this instance.
	*
	* @return {Quaternion} A clone of this instance.
	*/
	clone() {
		return new this.constructor(this._x, this._y, this._z, this._w);
	}
	/**
	* Copies the values of the given quaternion to this instance.
	*
	* @param {Quaternion} quaternion - The quaternion to copy.
	* @return {Quaternion} A reference to this quaternion.
	*/
	copy(quaternion) {
		this._x = quaternion.x;
		this._y = quaternion.y;
		this._z = quaternion.z;
		this._w = quaternion.w;
		this._onChangeCallback();
		return this;
	}
	/**
	* Sets this quaternion from the rotation specified by the given
	* Euler angles.
	*
	* @param {Euler} euler - The Euler angles.
	* @param {boolean} [update=true] - Whether the internal `onChange` callback should be executed or not.
	* @return {Quaternion} A reference to this quaternion.
	*/
	setFromEuler(euler, update = true) {
		const x = euler._x, y = euler._y, z = euler._z, order = euler._order;
		const cos = Math.cos;
		const sin = Math.sin;
		const c1 = cos(x / 2);
		const c2 = cos(y / 2);
		const c3 = cos(z / 2);
		const s1 = sin(x / 2);
		const s2 = sin(y / 2);
		const s3 = sin(z / 2);
		switch (order) {
			case "XYZ":
				this._x = s1 * c2 * c3 + c1 * s2 * s3;
				this._y = c1 * s2 * c3 - s1 * c2 * s3;
				this._z = c1 * c2 * s3 + s1 * s2 * c3;
				this._w = c1 * c2 * c3 - s1 * s2 * s3;
				break;
			case "YXZ":
				this._x = s1 * c2 * c3 + c1 * s2 * s3;
				this._y = c1 * s2 * c3 - s1 * c2 * s3;
				this._z = c1 * c2 * s3 - s1 * s2 * c3;
				this._w = c1 * c2 * c3 + s1 * s2 * s3;
				break;
			case "ZXY":
				this._x = s1 * c2 * c3 - c1 * s2 * s3;
				this._y = c1 * s2 * c3 + s1 * c2 * s3;
				this._z = c1 * c2 * s3 + s1 * s2 * c3;
				this._w = c1 * c2 * c3 - s1 * s2 * s3;
				break;
			case "ZYX":
				this._x = s1 * c2 * c3 - c1 * s2 * s3;
				this._y = c1 * s2 * c3 + s1 * c2 * s3;
				this._z = c1 * c2 * s3 - s1 * s2 * c3;
				this._w = c1 * c2 * c3 + s1 * s2 * s3;
				break;
			case "YZX":
				this._x = s1 * c2 * c3 + c1 * s2 * s3;
				this._y = c1 * s2 * c3 + s1 * c2 * s3;
				this._z = c1 * c2 * s3 - s1 * s2 * c3;
				this._w = c1 * c2 * c3 - s1 * s2 * s3;
				break;
			case "XZY":
				this._x = s1 * c2 * c3 - c1 * s2 * s3;
				this._y = c1 * s2 * c3 - s1 * c2 * s3;
				this._z = c1 * c2 * s3 + s1 * s2 * c3;
				this._w = c1 * c2 * c3 + s1 * s2 * s3;
				break;
			default: warn("Quaternion: .setFromEuler() encountered an unknown order: " + order);
		}
		if (update === true) this._onChangeCallback();
		return this;
	}
	/**
	* Sets this quaternion from the given axis and angle.
	*
	* @param {Vector3} axis - The normalized axis.
	* @param {number} angle - The angle in radians.
	* @return {Quaternion} A reference to this quaternion.
	*/
	setFromAxisAngle(axis, angle) {
		const halfAngle = angle / 2, s = Math.sin(halfAngle);
		this._x = axis.x * s;
		this._y = axis.y * s;
		this._z = axis.z * s;
		this._w = Math.cos(halfAngle);
		this._onChangeCallback();
		return this;
	}
	/**
	* Sets this quaternion from the given rotation matrix.
	*
	* @param {Matrix4} m - A 4x4 matrix of which the upper 3x3 of matrix is a pure rotation matrix (i.e. unscaled).
	* @return {Quaternion} A reference to this quaternion.
	*/
	setFromRotationMatrix(m) {
		const te = m.elements, m11 = te[0], m12 = te[4], m13 = te[8], m21 = te[1], m22 = te[5], m23 = te[9], m31 = te[2], m32 = te[6], m33 = te[10], trace = m11 + m22 + m33;
		if (trace > 0) {
			const s = .5 / Math.sqrt(trace + 1);
			this._w = .25 / s;
			this._x = (m32 - m23) * s;
			this._y = (m13 - m31) * s;
			this._z = (m21 - m12) * s;
		} else if (m11 > m22 && m11 > m33) {
			const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
			this._w = (m32 - m23) / s;
			this._x = .25 * s;
			this._y = (m12 + m21) / s;
			this._z = (m13 + m31) / s;
		} else if (m22 > m33) {
			const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
			this._w = (m13 - m31) / s;
			this._x = (m12 + m21) / s;
			this._y = .25 * s;
			this._z = (m23 + m32) / s;
		} else {
			const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
			this._w = (m21 - m12) / s;
			this._x = (m13 + m31) / s;
			this._y = (m23 + m32) / s;
			this._z = .25 * s;
		}
		this._onChangeCallback();
		return this;
	}
	/**
	* Sets this quaternion to the rotation required to rotate the direction vector
	* `vFrom` to the direction vector `vTo`.
	*
	* @param {Vector3} vFrom - The first (normalized) direction vector.
	* @param {Vector3} vTo - The second (normalized) direction vector.
	* @return {Quaternion} A reference to this quaternion.
	*/
	setFromUnitVectors(vFrom, vTo) {
		let r = vFrom.dot(vTo) + 1;
		if (r < 1e-8) {
			r = 0;
			if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
				this._x = -vFrom.y;
				this._y = vFrom.x;
				this._z = 0;
				this._w = r;
			} else {
				this._x = 0;
				this._y = -vFrom.z;
				this._z = vFrom.y;
				this._w = r;
			}
		} else {
			this._x = vFrom.y * vTo.z - vFrom.z * vTo.y;
			this._y = vFrom.z * vTo.x - vFrom.x * vTo.z;
			this._z = vFrom.x * vTo.y - vFrom.y * vTo.x;
			this._w = r;
		}
		return this.normalize();
	}
	/**
	* Returns the angle between this quaternion and the given one in radians.
	*
	* @param {Quaternion} q - The quaternion to compute the angle with.
	* @return {number} The angle in radians.
	*/
	angleTo(q) {
		return 2 * Math.acos(Math.abs(clamp$1(this.dot(q), -1, 1)));
	}
	/**
	* Rotates this quaternion by a given angular step to the given quaternion.
	* The method ensures that the final quaternion will not overshoot `q`.
	*
	* @param {Quaternion} q - The target quaternion.
	* @param {number} step - The angular step in radians.
	* @return {Quaternion} A reference to this quaternion.
	*/
	rotateTowards(q, step) {
		const angle = this.angleTo(q);
		if (angle === 0) return this;
		const t = Math.min(1, step / angle);
		this.slerp(q, t);
		return this;
	}
	/**
	* Sets this quaternion to the identity quaternion; that is, to the
	* quaternion that represents "no rotation".
	*
	* @return {Quaternion} A reference to this quaternion.
	*/
	identity() {
		return this.set(0, 0, 0, 1);
	}
	/**
	* Inverts this quaternion via {@link Quaternion#conjugate}. The
	* quaternion is assumed to have unit length.
	*
	* @return {Quaternion} A reference to this quaternion.
	*/
	invert() {
		return this.conjugate();
	}
	/**
	* Returns the rotational conjugate of this quaternion. The conjugate of a
	* quaternion represents the same rotation in the opposite direction about
	* the rotational axis.
	*
	* @return {Quaternion} A reference to this quaternion.
	*/
	conjugate() {
		this._x *= -1;
		this._y *= -1;
		this._z *= -1;
		this._onChangeCallback();
		return this;
	}
	/**
	* Calculates the dot product of this quaternion and the given one.
	*
	* @param {Quaternion} v - The quaternion to compute the dot product with.
	* @return {number} The result of the dot product.
	*/
	dot(v) {
		return this._x * v._x + this._y * v._y + this._z * v._z + this._w * v._w;
	}
	/**
	* Computes the squared Euclidean length (straight-line length) of this quaternion,
	* considered as a 4 dimensional vector. This can be useful if you are comparing the
	* lengths of two quaternions, as this is a slightly more efficient calculation than
	* {@link Quaternion#length}.
	*
	* @return {number} The squared Euclidean length.
	*/
	lengthSq() {
		return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w;
	}
	/**
	* Computes the Euclidean length (straight-line length) of this quaternion,
	* considered as a 4 dimensional vector.
	*
	* @return {number} The Euclidean length.
	*/
	length() {
		return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w);
	}
	/**
	* Normalizes this quaternion - that is, calculated the quaternion that performs
	* the same rotation as this one, but has a length equal to `1`.
	*
	* @return {Quaternion} A reference to this quaternion.
	*/
	normalize() {
		let l = this.length();
		if (l === 0) {
			this._x = 0;
			this._y = 0;
			this._z = 0;
			this._w = 1;
		} else {
			l = 1 / l;
			this._x = this._x * l;
			this._y = this._y * l;
			this._z = this._z * l;
			this._w = this._w * l;
		}
		this._onChangeCallback();
		return this;
	}
	/**
	* Multiplies this quaternion by the given one.
	*
	* @param {Quaternion} q - The quaternion.
	* @return {Quaternion} A reference to this quaternion.
	*/
	multiply(q) {
		return this.multiplyQuaternions(this, q);
	}
	/**
	* Pre-multiplies this quaternion by the given one.
	*
	* @param {Quaternion} q - The quaternion.
	* @return {Quaternion} A reference to this quaternion.
	*/
	premultiply(q) {
		return this.multiplyQuaternions(q, this);
	}
	/**
	* Multiplies the given quaternions and stores the result in this instance.
	*
	* @param {Quaternion} a - The first quaternion.
	* @param {Quaternion} b - The second quaternion.
	* @return {Quaternion} A reference to this quaternion.
	*/
	multiplyQuaternions(a, b) {
		const qax = a._x, qay = a._y, qaz = a._z, qaw = a._w;
		const qbx = b._x, qby = b._y, qbz = b._z, qbw = b._w;
		this._x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
		this._y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
		this._z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
		this._w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
		this._onChangeCallback();
		return this;
	}
	/**
	* Performs a spherical linear interpolation between this quaternion and the target quaternion.
	*
	* @param {Quaternion} qb - The target quaternion.
	* @param {number} t - The interpolation factor. A value in the range `[0,1]` will interpolate. A value outside the range `[0,1]` will extrapolate.
	* @return {Quaternion} A reference to this quaternion.
	*/
	slerp(qb, t) {
		let x = qb._x, y = qb._y, z = qb._z, w = qb._w;
		let dot = this.dot(qb);
		if (dot < 0) {
			x = -x;
			y = -y;
			z = -z;
			w = -w;
			dot = -dot;
		}
		let s = 1 - t;
		if (dot < .9995) {
			const theta = Math.acos(dot);
			const sin = Math.sin(theta);
			s = Math.sin(s * theta) / sin;
			t = Math.sin(t * theta) / sin;
			this._x = this._x * s + x * t;
			this._y = this._y * s + y * t;
			this._z = this._z * s + z * t;
			this._w = this._w * s + w * t;
			this._onChangeCallback();
		} else {
			this._x = this._x * s + x * t;
			this._y = this._y * s + y * t;
			this._z = this._z * s + z * t;
			this._w = this._w * s + w * t;
			this.normalize();
		}
		return this;
	}
	/**
	* Performs a spherical linear interpolation between the given quaternions
	* and stores the result in this quaternion.
	*
	* @param {Quaternion} qa - The source quaternion.
	* @param {Quaternion} qb - The target quaternion.
	* @param {number} t - The interpolation factor in the closed interval `[0, 1]`.
	* @return {Quaternion} A reference to this quaternion.
	*/
	slerpQuaternions(qa, qb, t) {
		return this.copy(qa).slerp(qb, t);
	}
	/**
	* Sets this quaternion to a uniformly random, normalized quaternion.
	*
	* @return {Quaternion} A reference to this quaternion.
	*/
	random() {
		const theta1 = 2 * Math.PI * Math.random();
		const theta2 = 2 * Math.PI * Math.random();
		const x0 = Math.random();
		const r1 = Math.sqrt(1 - x0);
		const r2 = Math.sqrt(x0);
		return this.set(r1 * Math.sin(theta1), r1 * Math.cos(theta1), r2 * Math.sin(theta2), r2 * Math.cos(theta2));
	}
	/**
	* Returns `true` if this quaternion is equal with the given one.
	*
	* @param {Quaternion} quaternion - The quaternion to test for equality.
	* @return {boolean} Whether this quaternion is equal with the given one.
	*/
	equals(quaternion) {
		return quaternion._x === this._x && quaternion._y === this._y && quaternion._z === this._z && quaternion._w === this._w;
	}
	/**
	* Sets this quaternion's components from the given array.
	*
	* @param {Array<number>} array - An array holding the quaternion component values.
	* @param {number} [offset=0] - The offset into the array.
	* @return {Quaternion} A reference to this quaternion.
	*/
	fromArray(array, offset = 0) {
		this._x = array[offset];
		this._y = array[offset + 1];
		this._z = array[offset + 2];
		this._w = array[offset + 3];
		this._onChangeCallback();
		return this;
	}
	/**
	* Writes the components of this quaternion to the given array. If no array is provided,
	* the method returns a new instance.
	*
	* @param {Array<number>} [array=[]] - The target array holding the quaternion components.
	* @param {number} [offset=0] - Index of the first element in the array.
	* @return {Array<number>} The quaternion components.
	*/
	toArray(array = [], offset = 0) {
		array[offset] = this._x;
		array[offset + 1] = this._y;
		array[offset + 2] = this._z;
		array[offset + 3] = this._w;
		return array;
	}
	/**
	* Sets the components of this quaternion from the given buffer attribute.
	*
	* @param {BufferAttribute} attribute - The buffer attribute holding quaternion data.
	* @param {number} index - The index into the attribute.
	* @return {Quaternion} A reference to this quaternion.
	*/
	fromBufferAttribute(attribute, index) {
		this._x = attribute.getX(index);
		this._y = attribute.getY(index);
		this._z = attribute.getZ(index);
		this._w = attribute.getW(index);
		this._onChangeCallback();
		return this;
	}
	/**
	* This methods defines the serialization result of this class. Returns the
	* numerical elements of this quaternion in an array of format `[x, y, z, w]`.
	*
	* @return {Array<number>} The serialized quaternion.
	*/
	toJSON() {
		return this.toArray();
	}
	_onChange(callback) {
		this._onChangeCallback = callback;
		return this;
	}
	_onChangeCallback() {}
	*[Symbol.iterator]() {
		yield this._x;
		yield this._y;
		yield this._z;
		yield this._w;
	}
};
/**
* Class representing a 3D vector. A 3D vector is an ordered triplet of numbers
* (labeled x, y and z), which can be used to represent a number of things, such as:
*
* - A point in 3D space.
* - A direction and length in 3D space. In three.js the length will
* always be the Euclidean distance(straight-line distance) from `(0, 0, 0)` to `(x, y, z)`
* and the direction is also measured from `(0, 0, 0)` towards `(x, y, z)`.
* - Any arbitrary ordered triplet of numbers.
*
* There are other things a 3D vector can be used to represent, such as
* momentum vectors and so on, however these are the most
* common uses in three.js.
*
* Iterating through a vector instance will yield its components `(x, y, z)` in
* the corresponding order.
* ```js
* const a = new THREE.Vector3( 0, 1, 0 );
*
* //no arguments; will be initialised to (0, 0, 0)
* const b = new THREE.Vector3( );
*
* const d = a.distanceTo( b );
* ```
*/
var Vector3 = class Vector3 {
	static {
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		Vector3.prototype.isVector3 = true;
	}
	/**
	* Constructs a new 3D vector.
	*
	* @param {number} [x=0] - The x value of this vector.
	* @param {number} [y=0] - The y value of this vector.
	* @param {number} [z=0] - The z value of this vector.
	*/
	constructor(x = 0, y = 0, z = 0) {
		/**
		* The x value of this vector.
		*
		* @type {number}
		*/
		this.x = x;
		/**
		* The y value of this vector.
		*
		* @type {number}
		*/
		this.y = y;
		/**
		* The z value of this vector.
		*
		* @type {number}
		*/
		this.z = z;
	}
	/**
	* Sets the vector components.
	*
	* @param {number} x - The value of the x component.
	* @param {number} y - The value of the y component.
	* @param {number} z - The value of the z component.
	* @return {Vector3} A reference to this vector.
	*/
	set(x, y, z) {
		if (z === void 0) z = this.z;
		this.x = x;
		this.y = y;
		this.z = z;
		return this;
	}
	/**
	* Sets the vector components to the same value.
	*
	* @param {number} scalar - The value to set for all vector components.
	* @return {Vector3} A reference to this vector.
	*/
	setScalar(scalar) {
		this.x = scalar;
		this.y = scalar;
		this.z = scalar;
		return this;
	}
	/**
	* Sets the vector's x component to the given value.
	*
	* @param {number} x - The value to set.
	* @return {Vector3} A reference to this vector.
	*/
	setX(x) {
		this.x = x;
		return this;
	}
	/**
	* Sets the vector's y component to the given value.
	*
	* @param {number} y - The value to set.
	* @return {Vector3} A reference to this vector.
	*/
	setY(y) {
		this.y = y;
		return this;
	}
	/**
	* Sets the vector's z component to the given value.
	*
	* @param {number} z - The value to set.
	* @return {Vector3} A reference to this vector.
	*/
	setZ(z) {
		this.z = z;
		return this;
	}
	/**
	* Allows to set a vector component with an index.
	*
	* @param {number} index - The component index. `0` equals to x, `1` equals to y, `2` equals to z.
	* @param {number} value - The value to set.
	* @return {Vector3} A reference to this vector.
	*/
	setComponent(index, value) {
		switch (index) {
			case 0:
				this.x = value;
				break;
			case 1:
				this.y = value;
				break;
			case 2:
				this.z = value;
				break;
			default: throw new Error("THREE.Vector3: index is out of range: " + index);
		}
		return this;
	}
	/**
	* Returns the value of the vector component which matches the given index.
	*
	* @param {number} index - The component index. `0` equals to x, `1` equals to y, `2` equals to z.
	* @return {number} A vector component value.
	*/
	getComponent(index) {
		switch (index) {
			case 0: return this.x;
			case 1: return this.y;
			case 2: return this.z;
			default: throw new Error("THREE.Vector3: index is out of range: " + index);
		}
	}
	/**
	* Returns a new vector with copied values from this instance.
	*
	* @return {Vector3} A clone of this instance.
	*/
	clone() {
		return new this.constructor(this.x, this.y, this.z);
	}
	/**
	* Copies the values of the given vector to this instance.
	*
	* @param {Vector3} v - The vector to copy.
	* @return {Vector3} A reference to this vector.
	*/
	copy(v) {
		this.x = v.x;
		this.y = v.y;
		this.z = v.z;
		return this;
	}
	/**
	* Adds the given vector to this instance.
	*
	* @param {Vector3} v - The vector to add.
	* @return {Vector3} A reference to this vector.
	*/
	add(v) {
		this.x += v.x;
		this.y += v.y;
		this.z += v.z;
		return this;
	}
	/**
	* Adds the given scalar value to all components of this instance.
	*
	* @param {number} s - The scalar to add.
	* @return {Vector3} A reference to this vector.
	*/
	addScalar(s) {
		this.x += s;
		this.y += s;
		this.z += s;
		return this;
	}
	/**
	* Adds the given vectors and stores the result in this instance.
	*
	* @param {Vector3} a - The first vector.
	* @param {Vector3} b - The second vector.
	* @return {Vector3} A reference to this vector.
	*/
	addVectors(a, b) {
		this.x = a.x + b.x;
		this.y = a.y + b.y;
		this.z = a.z + b.z;
		return this;
	}
	/**
	* Adds the given vector scaled by the given factor to this instance.
	*
	* @param {Vector3|Vector4} v - The vector.
	* @param {number} s - The factor that scales `v`.
	* @return {Vector3} A reference to this vector.
	*/
	addScaledVector(v, s) {
		this.x += v.x * s;
		this.y += v.y * s;
		this.z += v.z * s;
		return this;
	}
	/**
	* Subtracts the given vector from this instance.
	*
	* @param {Vector3} v - The vector to subtract.
	* @return {Vector3} A reference to this vector.
	*/
	sub(v) {
		this.x -= v.x;
		this.y -= v.y;
		this.z -= v.z;
		return this;
	}
	/**
	* Subtracts the given scalar value from all components of this instance.
	*
	* @param {number} s - The scalar to subtract.
	* @return {Vector3} A reference to this vector.
	*/
	subScalar(s) {
		this.x -= s;
		this.y -= s;
		this.z -= s;
		return this;
	}
	/**
	* Subtracts the given vectors and stores the result in this instance.
	*
	* @param {Vector3} a - The first vector.
	* @param {Vector3} b - The second vector.
	* @return {Vector3} A reference to this vector.
	*/
	subVectors(a, b) {
		this.x = a.x - b.x;
		this.y = a.y - b.y;
		this.z = a.z - b.z;
		return this;
	}
	/**
	* Multiplies the given vector with this instance.
	*
	* @param {Vector3} v - The vector to multiply.
	* @return {Vector3} A reference to this vector.
	*/
	multiply(v) {
		this.x *= v.x;
		this.y *= v.y;
		this.z *= v.z;
		return this;
	}
	/**
	* Multiplies the given scalar value with all components of this instance.
	*
	* @param {number} scalar - The scalar to multiply.
	* @return {Vector3} A reference to this vector.
	*/
	multiplyScalar(scalar) {
		this.x *= scalar;
		this.y *= scalar;
		this.z *= scalar;
		return this;
	}
	/**
	* Multiplies the given vectors and stores the result in this instance.
	*
	* @param {Vector3} a - The first vector.
	* @param {Vector3} b - The second vector.
	* @return {Vector3} A reference to this vector.
	*/
	multiplyVectors(a, b) {
		this.x = a.x * b.x;
		this.y = a.y * b.y;
		this.z = a.z * b.z;
		return this;
	}
	/**
	* Applies the given Euler rotation to this vector.
	*
	* @param {Euler} euler - The Euler angles.
	* @return {Vector3} A reference to this vector.
	*/
	applyEuler(euler) {
		return this.applyQuaternion(_quaternion$5.setFromEuler(euler));
	}
	/**
	* Applies a rotation specified by an axis and an angle to this vector.
	*
	* @param {Vector3} axis - A normalized vector representing the rotation axis.
	* @param {number} angle - The angle in radians.
	* @return {Vector3} A reference to this vector.
	*/
	applyAxisAngle(axis, angle) {
		return this.applyQuaternion(_quaternion$5.setFromAxisAngle(axis, angle));
	}
	/**
	* Multiplies this vector with the given 3x3 matrix.
	*
	* @param {Matrix3} m - The 3x3 matrix.
	* @return {Vector3} A reference to this vector.
	*/
	applyMatrix3(m) {
		const x = this.x, y = this.y, z = this.z;
		const e = m.elements;
		this.x = e[0] * x + e[3] * y + e[6] * z;
		this.y = e[1] * x + e[4] * y + e[7] * z;
		this.z = e[2] * x + e[5] * y + e[8] * z;
		return this;
	}
	/**
	* Multiplies this vector by the given normal matrix and normalizes
	* the result.
	*
	* @param {Matrix3} m - The normal matrix.
	* @return {Vector3} A reference to this vector.
	*/
	applyNormalMatrix(m) {
		return this.applyMatrix3(m).normalize();
	}
	/**
	* Multiplies this vector (with an implicit 1 in the 4th dimension) by m, and
	* divides by perspective.
	*
	* @param {Matrix4} m - The matrix to apply.
	* @return {Vector3} A reference to this vector.
	*/
	applyMatrix4(m) {
		const x = this.x, y = this.y, z = this.z;
		const e = m.elements;
		const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
		this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
		this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
		this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
		return this;
	}
	/**
	* Applies the given Quaternion to this vector.
	*
	* @param {Quaternion} q - The Quaternion.
	* @return {Vector3} A reference to this vector.
	*/
	applyQuaternion(q) {
		const vx = this.x, vy = this.y, vz = this.z;
		const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
		const tx = 2 * (qy * vz - qz * vy);
		const ty = 2 * (qz * vx - qx * vz);
		const tz = 2 * (qx * vy - qy * vx);
		this.x = vx + qw * tx + qy * tz - qz * ty;
		this.y = vy + qw * ty + qz * tx - qx * tz;
		this.z = vz + qw * tz + qx * ty - qy * tx;
		return this;
	}
	/**
	* Projects this vector from world space into the camera's normalized
	* device coordinate (NDC) space.
	*
	* @param {Camera} camera - The camera.
	* @return {Vector3} A reference to this vector.
	*/
	project(camera) {
		return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
	}
	/**
	* Unprojects this vector from the camera's normalized device coordinate (NDC)
	* space into world space.
	*
	* @param {Camera} camera - The camera.
	* @return {Vector3} A reference to this vector.
	*/
	unproject(camera) {
		return this.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld);
	}
	/**
	* Transforms the direction of this vector by a matrix (the upper left 3 x 3
	* subset of the given 4x4 matrix and then normalizes the result.
	*
	* @param {Matrix4} m - The matrix.
	* @return {Vector3} A reference to this vector.
	*/
	transformDirection(m) {
		const x = this.x, y = this.y, z = this.z;
		const e = m.elements;
		this.x = e[0] * x + e[4] * y + e[8] * z;
		this.y = e[1] * x + e[5] * y + e[9] * z;
		this.z = e[2] * x + e[6] * y + e[10] * z;
		return this.normalize();
	}
	/**
	* Divides this instance by the given vector.
	*
	* @param {Vector3} v - The vector to divide.
	* @return {Vector3} A reference to this vector.
	*/
	divide(v) {
		this.x /= v.x;
		this.y /= v.y;
		this.z /= v.z;
		return this;
	}
	/**
	* Divides this vector by the given scalar.
	*
	* @param {number} scalar - The scalar to divide.
	* @return {Vector3} A reference to this vector.
	*/
	divideScalar(scalar) {
		return this.multiplyScalar(1 / scalar);
	}
	/**
	* If this vector's x, y or z value is greater than the given vector's x, y or z
	* value, replace that value with the corresponding min value.
	*
	* @param {Vector3} v - The vector.
	* @return {Vector3} A reference to this vector.
	*/
	min(v) {
		this.x = Math.min(this.x, v.x);
		this.y = Math.min(this.y, v.y);
		this.z = Math.min(this.z, v.z);
		return this;
	}
	/**
	* If this vector's x, y or z value is less than the given vector's x, y or z
	* value, replace that value with the corresponding max value.
	*
	* @param {Vector3} v - The vector.
	* @return {Vector3} A reference to this vector.
	*/
	max(v) {
		this.x = Math.max(this.x, v.x);
		this.y = Math.max(this.y, v.y);
		this.z = Math.max(this.z, v.z);
		return this;
	}
	/**
	* If this vector's x, y or z value is greater than the max vector's x, y or z
	* value, it is replaced by the corresponding value.
	* If this vector's x, y or z value is less than the min vector's x, y or z value,
	* it is replaced by the corresponding value.
	*
	* @param {Vector3} min - The minimum x, y and z values.
	* @param {Vector3} max - The maximum x, y and z values in the desired range.
	* @return {Vector3} A reference to this vector.
	*/
	clamp(min, max) {
		this.x = clamp$1(this.x, min.x, max.x);
		this.y = clamp$1(this.y, min.y, max.y);
		this.z = clamp$1(this.z, min.z, max.z);
		return this;
	}
	/**
	* If this vector's x, y or z values are greater than the max value, they are
	* replaced by the max value.
	* If this vector's x, y or z values are less than the min value, they are
	* replaced by the min value.
	*
	* @param {number} minVal - The minimum value the components will be clamped to.
	* @param {number} maxVal - The maximum value the components will be clamped to.
	* @return {Vector3} A reference to this vector.
	*/
	clampScalar(minVal, maxVal) {
		this.x = clamp$1(this.x, minVal, maxVal);
		this.y = clamp$1(this.y, minVal, maxVal);
		this.z = clamp$1(this.z, minVal, maxVal);
		return this;
	}
	/**
	* If this vector's length is greater than the max value, it is replaced by
	* the max value.
	* If this vector's length is less than the min value, it is replaced by the
	* min value.
	*
	* @param {number} min - The minimum value the vector length will be clamped to.
	* @param {number} max - The maximum value the vector length will be clamped to.
	* @return {Vector3} A reference to this vector.
	*/
	clampLength(min, max) {
		const length = this.length();
		return this.divideScalar(length || 1).multiplyScalar(clamp$1(length, min, max));
	}
	/**
	* The components of this vector are rounded down to the nearest integer value.
	*
	* @return {Vector3} A reference to this vector.
	*/
	floor() {
		this.x = Math.floor(this.x);
		this.y = Math.floor(this.y);
		this.z = Math.floor(this.z);
		return this;
	}
	/**
	* The components of this vector are rounded up to the nearest integer value.
	*
	* @return {Vector3} A reference to this vector.
	*/
	ceil() {
		this.x = Math.ceil(this.x);
		this.y = Math.ceil(this.y);
		this.z = Math.ceil(this.z);
		return this;
	}
	/**
	* The components of this vector are rounded to the nearest integer value
	*
	* @return {Vector3} A reference to this vector.
	*/
	round() {
		this.x = Math.round(this.x);
		this.y = Math.round(this.y);
		this.z = Math.round(this.z);
		return this;
	}
	/**
	* The components of this vector are rounded towards zero (up if negative,
	* down if positive) to an integer value.
	*
	* @return {Vector3} A reference to this vector.
	*/
	roundToZero() {
		this.x = Math.trunc(this.x);
		this.y = Math.trunc(this.y);
		this.z = Math.trunc(this.z);
		return this;
	}
	/**
	* Inverts this vector - i.e. sets x = -x, y = -y and z = -z.
	*
	* @return {Vector3} A reference to this vector.
	*/
	negate() {
		this.x = -this.x;
		this.y = -this.y;
		this.z = -this.z;
		return this;
	}
	/**
	* Calculates the dot product of the given vector with this instance.
	*
	* @param {Vector3} v - The vector to compute the dot product with.
	* @return {number} The result of the dot product.
	*/
	dot(v) {
		return this.x * v.x + this.y * v.y + this.z * v.z;
	}
	/**
	* Computes the square of the Euclidean length (straight-line length) from
	* (0, 0, 0) to (x, y, z). If you are comparing the lengths of vectors, you should
	* compare the length squared instead as it is slightly more efficient to calculate.
	*
	* @return {number} The square length of this vector.
	*/
	lengthSq() {
		return this.x * this.x + this.y * this.y + this.z * this.z;
	}
	/**
	* Computes the  Euclidean length (straight-line length) from (0, 0, 0) to (x, y, z).
	*
	* @return {number} The length of this vector.
	*/
	length() {
		return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
	}
	/**
	* Computes the Manhattan length of this vector.
	*
	* @return {number} The length of this vector.
	*/
	manhattanLength() {
		return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z);
	}
	/**
	* Converts this vector to a unit vector - that is, sets it equal to a vector
	* with the same direction as this one, but with a vector length of `1`.
	*
	* @return {Vector3} A reference to this vector.
	*/
	normalize() {
		return this.divideScalar(this.length() || 1);
	}
	/**
	* Sets this vector to a vector with the same direction as this one, but
	* with the specified length.
	*
	* @param {number} length - The new length of this vector.
	* @return {Vector3} A reference to this vector.
	*/
	setLength(length) {
		return this.normalize().multiplyScalar(length);
	}
	/**
	* Linearly interpolates between the given vector and this instance, where
	* alpha is the percent distance along the line - alpha = 0 will be this
	* vector, and alpha = 1 will be the given one.
	*
	* @param {Vector3} v - The vector to interpolate towards.
	* @param {number} alpha - The interpolation factor, typically in the closed interval `[0, 1]`.
	* @return {Vector3} A reference to this vector.
	*/
	lerp(v, alpha) {
		this.x += (v.x - this.x) * alpha;
		this.y += (v.y - this.y) * alpha;
		this.z += (v.z - this.z) * alpha;
		return this;
	}
	/**
	* Linearly interpolates between the given vectors, where alpha is the percent
	* distance along the line - alpha = 0 will be first vector, and alpha = 1 will
	* be the second one. The result is stored in this instance.
	*
	* @param {Vector3} v1 - The first vector.
	* @param {Vector3} v2 - The second vector.
	* @param {number} alpha - The interpolation factor, typically in the closed interval `[0, 1]`.
	* @return {Vector3} A reference to this vector.
	*/
	lerpVectors(v1, v2, alpha) {
		this.x = v1.x + (v2.x - v1.x) * alpha;
		this.y = v1.y + (v2.y - v1.y) * alpha;
		this.z = v1.z + (v2.z - v1.z) * alpha;
		return this;
	}
	/**
	* Calculates the cross product of the given vector with this instance.
	*
	* @param {Vector3} v - The vector to compute the cross product with.
	* @return {Vector3} The result of the cross product.
	*/
	cross(v) {
		return this.crossVectors(this, v);
	}
	/**
	* Calculates the cross product of the given vectors and stores the result
	* in this instance.
	*
	* @param {Vector3} a - The first vector.
	* @param {Vector3} b - The second vector.
	* @return {Vector3} A reference to this vector.
	*/
	crossVectors(a, b) {
		const ax = a.x, ay = a.y, az = a.z;
		const bx = b.x, by = b.y, bz = b.z;
		this.x = ay * bz - az * by;
		this.y = az * bx - ax * bz;
		this.z = ax * by - ay * bx;
		return this;
	}
	/**
	* Projects this vector onto the given one.
	*
	* @param {Vector3} v - The vector to project to.
	* @return {Vector3} A reference to this vector.
	*/
	projectOnVector(v) {
		const denominator = v.lengthSq();
		if (denominator === 0) return this.set(0, 0, 0);
		const scalar = v.dot(this) / denominator;
		return this.copy(v).multiplyScalar(scalar);
	}
	/**
	* Projects this vector onto a plane by subtracting this
	* vector projected onto the plane's normal from this vector.
	*
	* @param {Vector3} planeNormal - The plane normal.
	* @return {Vector3} A reference to this vector.
	*/
	projectOnPlane(planeNormal) {
		_vector$c.copy(this).projectOnVector(planeNormal);
		return this.sub(_vector$c);
	}
	/**
	* Reflects this vector off a plane orthogonal to the given normal vector.
	*
	* @param {Vector3} normal - The (normalized) normal vector.
	* @return {Vector3} A reference to this vector.
	*/
	reflect(normal) {
		return this.sub(_vector$c.copy(normal).multiplyScalar(2 * this.dot(normal)));
	}
	/**
	* Returns the angle between the given vector and this instance in radians.
	*
	* @param {Vector3} v - The vector to compute the angle with.
	* @return {number} The angle in radians.
	*/
	angleTo(v) {
		const denominator = Math.sqrt(this.lengthSq() * v.lengthSq());
		if (denominator === 0) return Math.PI / 2;
		const theta = this.dot(v) / denominator;
		return Math.acos(clamp$1(theta, -1, 1));
	}
	/**
	* Computes the distance from the given vector to this instance.
	*
	* @param {Vector3} v - The vector to compute the distance to.
	* @return {number} The distance.
	*/
	distanceTo(v) {
		return Math.sqrt(this.distanceToSquared(v));
	}
	/**
	* Computes the squared distance from the given vector to this instance.
	* If you are just comparing the distance with another distance, you should compare
	* the distance squared instead as it is slightly more efficient to calculate.
	*
	* @param {Vector3} v - The vector to compute the squared distance to.
	* @return {number} The squared distance.
	*/
	distanceToSquared(v) {
		const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
		return dx * dx + dy * dy + dz * dz;
	}
	/**
	* Computes the Manhattan distance from the given vector to this instance.
	*
	* @param {Vector3} v - The vector to compute the Manhattan distance to.
	* @return {number} The Manhattan distance.
	*/
	manhattanDistanceTo(v) {
		return Math.abs(this.x - v.x) + Math.abs(this.y - v.y) + Math.abs(this.z - v.z);
	}
	/**
	* Sets the vector components from the given spherical coordinates.
	*
	* @param {Spherical} s - The spherical coordinates.
	* @return {Vector3} A reference to this vector.
	*/
	setFromSpherical(s) {
		return this.setFromSphericalCoords(s.radius, s.phi, s.theta);
	}
	/**
	* Sets the vector components from the given spherical coordinates.
	*
	* @param {number} radius - The radius.
	* @param {number} phi - The phi angle in radians.
	* @param {number} theta - The theta angle in radians.
	* @return {Vector3} A reference to this vector.
	*/
	setFromSphericalCoords(radius, phi, theta) {
		const sinPhiRadius = Math.sin(phi) * radius;
		this.x = sinPhiRadius * Math.sin(theta);
		this.y = Math.cos(phi) * radius;
		this.z = sinPhiRadius * Math.cos(theta);
		return this;
	}
	/**
	* Sets the vector components from the given cylindrical coordinates.
	*
	* @param {Cylindrical} c - The cylindrical coordinates.
	* @return {Vector3} A reference to this vector.
	*/
	setFromCylindrical(c) {
		return this.setFromCylindricalCoords(c.radius, c.theta, c.y);
	}
	/**
	* Sets the vector components from the given cylindrical coordinates.
	*
	* @param {number} radius - The radius.
	* @param {number} theta - The theta angle in radians.
	* @param {number} y - The y value.
	* @return {Vector3} A reference to this vector.
	*/
	setFromCylindricalCoords(radius, theta, y) {
		this.x = radius * Math.sin(theta);
		this.y = y;
		this.z = radius * Math.cos(theta);
		return this;
	}
	/**
	* Sets the vector components to the position elements of the
	* given transformation matrix.
	*
	* @param {Matrix4} m - The 4x4 matrix.
	* @return {Vector3} A reference to this vector.
	*/
	setFromMatrixPosition(m) {
		const e = m.elements;
		this.x = e[12];
		this.y = e[13];
		this.z = e[14];
		return this;
	}
	/**
	* Sets the vector components to the scale elements of the
	* given transformation matrix.
	*
	* @param {Matrix4} m - The 4x4 matrix.
	* @return {Vector3} A reference to this vector.
	*/
	setFromMatrixScale(m) {
		const sx = this.setFromMatrixColumn(m, 0).length();
		const sy = this.setFromMatrixColumn(m, 1).length();
		const sz = this.setFromMatrixColumn(m, 2).length();
		this.x = sx;
		this.y = sy;
		this.z = sz;
		return this;
	}
	/**
	* Sets the vector components from the specified matrix column.
	*
	* @param {Matrix4} m - The 4x4 matrix.
	* @param {number} index - The column index.
	* @return {Vector3} A reference to this vector.
	*/
	setFromMatrixColumn(m, index) {
		return this.fromArray(m.elements, index * 4);
	}
	/**
	* Sets the vector components from the specified matrix column.
	*
	* @param {Matrix3} m - The 3x3 matrix.
	* @param {number} index - The column index.
	* @return {Vector3} A reference to this vector.
	*/
	setFromMatrix3Column(m, index) {
		return this.fromArray(m.elements, index * 3);
	}
	/**
	* Sets the vector components from the given Euler angles.
	*
	* @param {Euler} e - The Euler angles to set.
	* @return {Vector3} A reference to this vector.
	*/
	setFromEuler(e) {
		this.x = e._x;
		this.y = e._y;
		this.z = e._z;
		return this;
	}
	/**
	* Sets the vector components from the RGB components of the
	* given color.
	*
	* @param {Color} c - The color to set.
	* @return {Vector3} A reference to this vector.
	*/
	setFromColor(c) {
		this.x = c.r;
		this.y = c.g;
		this.z = c.b;
		return this;
	}
	/**
	* Returns `true` if this vector is equal with the given one.
	*
	* @param {Vector3} v - The vector to test for equality.
	* @return {boolean} Whether this vector is equal with the given one.
	*/
	equals(v) {
		return v.x === this.x && v.y === this.y && v.z === this.z;
	}
	/**
	* Sets this vector's x value to be `array[ offset ]`, y value to be `array[ offset + 1 ]`
	* and z value to be `array[ offset + 2 ]`.
	*
	* @param {Array<number>} array - An array holding the vector component values.
	* @param {number} [offset=0] - The offset into the array.
	* @return {Vector3} A reference to this vector.
	*/
	fromArray(array, offset = 0) {
		this.x = array[offset];
		this.y = array[offset + 1];
		this.z = array[offset + 2];
		return this;
	}
	/**
	* Writes the components of this vector to the given array. If no array is provided,
	* the method returns a new instance.
	*
	* @param {Array<number>} [array=[]] - The target array holding the vector components.
	* @param {number} [offset=0] - Index of the first element in the array.
	* @return {Array<number>} The vector components.
	*/
	toArray(array = [], offset = 0) {
		array[offset] = this.x;
		array[offset + 1] = this.y;
		array[offset + 2] = this.z;
		return array;
	}
	/**
	* Sets the components of this vector from the given buffer attribute.
	*
	* @param {BufferAttribute} attribute - The buffer attribute holding vector data.
	* @param {number} index - The index into the attribute.
	* @return {Vector3} A reference to this vector.
	*/
	fromBufferAttribute(attribute, index) {
		this.x = attribute.getX(index);
		this.y = attribute.getY(index);
		this.z = attribute.getZ(index);
		return this;
	}
	/**
	* Sets each component of this vector to a pseudo-random value between `0` and
	* `1`, excluding `1`.
	*
	* @return {Vector3} A reference to this vector.
	*/
	random() {
		this.x = Math.random();
		this.y = Math.random();
		this.z = Math.random();
		return this;
	}
	/**
	* Sets this vector to a uniformly random point on a unit sphere.
	*
	* @return {Vector3} A reference to this vector.
	*/
	randomDirection() {
		const theta = Math.random() * Math.PI * 2;
		const u = Math.random() * 2 - 1;
		const c = Math.sqrt(1 - u * u);
		this.x = c * Math.cos(theta);
		this.y = u;
		this.z = c * Math.sin(theta);
		return this;
	}
	*[Symbol.iterator]() {
		yield this.x;
		yield this.y;
		yield this.z;
	}
};
const _vector$c = /*@__PURE__*/ new Vector3();
const _quaternion$5 = /*@__PURE__*/ new Quaternion();
/**
* Represents a 3x3 matrix.
*
* A Note on Row-Major and Column-Major Ordering:
*
* The constructor and {@link Matrix3#set} method take arguments in
* [row-major](https://en.wikipedia.org/wiki/Row-_and_column-major_order#Column-major_order)
* order, while internally they are stored in the {@link Matrix3#elements} array in column-major order.
* This means that calling:
* ```js
* const m = new THREE.Matrix();
* m.set( 11, 12, 13,
*        21, 22, 23,
*        31, 32, 33 );
* ```
* will result in the elements array containing:
* ```js
* m.elements = [ 11, 21, 31,
*                12, 22, 32,
*                13, 23, 33 ];
* ```
* and internally all calculations are performed using column-major ordering.
* However, as the actual ordering makes no difference mathematically and
* most people are used to thinking about matrices in row-major order, the
* three.js documentation shows matrices in row-major order. Just bear in
* mind that if you are reading the source code, you'll have to take the
* transpose of any matrices outlined here to make sense of the calculations.
*/
var Matrix3 = class Matrix3 {
	static {
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		Matrix3.prototype.isMatrix3 = true;
	}
	/**
	* Constructs a new 3x3 matrix. The arguments are supposed to be
	* in row-major order. If no arguments are provided, the constructor
	* initializes the matrix as an identity matrix.
	*
	* @param {number} [n11] - 1-1 matrix element.
	* @param {number} [n12] - 1-2 matrix element.
	* @param {number} [n13] - 1-3 matrix element.
	* @param {number} [n21] - 2-1 matrix element.
	* @param {number} [n22] - 2-2 matrix element.
	* @param {number} [n23] - 2-3 matrix element.
	* @param {number} [n31] - 3-1 matrix element.
	* @param {number} [n32] - 3-2 matrix element.
	* @param {number} [n33] - 3-3 matrix element.
	*/
	constructor(n11, n12, n13, n21, n22, n23, n31, n32, n33) {
		/**
		* A column-major list of matrix values.
		*
		* @type {Array<number>}
		*/
		this.elements = [
			1,
			0,
			0,
			0,
			1,
			0,
			0,
			0,
			1
		];
		if (n11 !== void 0) this.set(n11, n12, n13, n21, n22, n23, n31, n32, n33);
	}
	/**
	* Sets the elements of the matrix.The arguments are supposed to be
	* in row-major order.
	*
	* @param {number} [n11] - 1-1 matrix element.
	* @param {number} [n12] - 1-2 matrix element.
	* @param {number} [n13] - 1-3 matrix element.
	* @param {number} [n21] - 2-1 matrix element.
	* @param {number} [n22] - 2-2 matrix element.
	* @param {number} [n23] - 2-3 matrix element.
	* @param {number} [n31] - 3-1 matrix element.
	* @param {number} [n32] - 3-2 matrix element.
	* @param {number} [n33] - 3-3 matrix element.
	* @return {Matrix3} A reference to this matrix.
	*/
	set(n11, n12, n13, n21, n22, n23, n31, n32, n33) {
		const te = this.elements;
		te[0] = n11;
		te[1] = n21;
		te[2] = n31;
		te[3] = n12;
		te[4] = n22;
		te[5] = n32;
		te[6] = n13;
		te[7] = n23;
		te[8] = n33;
		return this;
	}
	/**
	* Sets this matrix to the 3x3 identity matrix.
	*
	* @return {Matrix3} A reference to this matrix.
	*/
	identity() {
		this.set(1, 0, 0, 0, 1, 0, 0, 0, 1);
		return this;
	}
	/**
	* Copies the values of the given matrix to this instance.
	*
	* @param {Matrix3} m - The matrix to copy.
	* @return {Matrix3} A reference to this matrix.
	*/
	copy(m) {
		const te = this.elements;
		const me = m.elements;
		te[0] = me[0];
		te[1] = me[1];
		te[2] = me[2];
		te[3] = me[3];
		te[4] = me[4];
		te[5] = me[5];
		te[6] = me[6];
		te[7] = me[7];
		te[8] = me[8];
		return this;
	}
	/**
	* Extracts the basis of this matrix into the three axis vectors provided.
	*
	* @param {Vector3} xAxis - The basis's x axis.
	* @param {Vector3} yAxis - The basis's y axis.
	* @param {Vector3} zAxis - The basis's z axis.
	* @return {Matrix3} A reference to this matrix.
	*/
	extractBasis(xAxis, yAxis, zAxis) {
		xAxis.setFromMatrix3Column(this, 0);
		yAxis.setFromMatrix3Column(this, 1);
		zAxis.setFromMatrix3Column(this, 2);
		return this;
	}
	/**
	* Set this matrix to the upper 3x3 matrix of the given 4x4 matrix.
	*
	* @param {Matrix4} m - The 4x4 matrix.
	* @return {Matrix3} A reference to this matrix.
	*/
	setFromMatrix4(m) {
		const me = m.elements;
		this.set(me[0], me[4], me[8], me[1], me[5], me[9], me[2], me[6], me[10]);
		return this;
	}
	/**
	* Post-multiplies this matrix by the given 3x3 matrix.
	*
	* @param {Matrix3} m - The matrix to multiply with.
	* @return {Matrix3} A reference to this matrix.
	*/
	multiply(m) {
		return this.multiplyMatrices(this, m);
	}
	/**
	* Pre-multiplies this matrix by the given 3x3 matrix.
	*
	* @param {Matrix3} m - The matrix to multiply with.
	* @return {Matrix3} A reference to this matrix.
	*/
	premultiply(m) {
		return this.multiplyMatrices(m, this);
	}
	/**
	* Multiples the given 3x3 matrices and stores the result
	* in this matrix.
	*
	* @param {Matrix3} a - The first matrix.
	* @param {Matrix3} b - The second matrix.
	* @return {Matrix3} A reference to this matrix.
	*/
	multiplyMatrices(a, b) {
		const ae = a.elements;
		const be = b.elements;
		const te = this.elements;
		const a11 = ae[0], a12 = ae[3], a13 = ae[6];
		const a21 = ae[1], a22 = ae[4], a23 = ae[7];
		const a31 = ae[2], a32 = ae[5], a33 = ae[8];
		const b11 = be[0], b12 = be[3], b13 = be[6];
		const b21 = be[1], b22 = be[4], b23 = be[7];
		const b31 = be[2], b32 = be[5], b33 = be[8];
		te[0] = a11 * b11 + a12 * b21 + a13 * b31;
		te[3] = a11 * b12 + a12 * b22 + a13 * b32;
		te[6] = a11 * b13 + a12 * b23 + a13 * b33;
		te[1] = a21 * b11 + a22 * b21 + a23 * b31;
		te[4] = a21 * b12 + a22 * b22 + a23 * b32;
		te[7] = a21 * b13 + a22 * b23 + a23 * b33;
		te[2] = a31 * b11 + a32 * b21 + a33 * b31;
		te[5] = a31 * b12 + a32 * b22 + a33 * b32;
		te[8] = a31 * b13 + a32 * b23 + a33 * b33;
		return this;
	}
	/**
	* Multiplies every component of the matrix by the given scalar.
	*
	* @param {number} s - The scalar.
	* @return {Matrix3} A reference to this matrix.
	*/
	multiplyScalar(s) {
		const te = this.elements;
		te[0] *= s;
		te[3] *= s;
		te[6] *= s;
		te[1] *= s;
		te[4] *= s;
		te[7] *= s;
		te[2] *= s;
		te[5] *= s;
		te[8] *= s;
		return this;
	}
	/**
	* Computes and returns the determinant of this matrix.
	*
	* @return {number} The determinant.
	*/
	determinant() {
		const te = this.elements;
		const a = te[0], b = te[1], c = te[2], d = te[3], e = te[4], f = te[5], g = te[6], h = te[7], i = te[8];
		return a * e * i - a * f * h - b * d * i + b * f * g + c * d * h - c * e * g;
	}
	/**
	* Inverts this matrix, using the [analytic method](https://en.wikipedia.org/wiki/Invertible_matrix#Analytic_solution).
	* You can not invert with a determinant of zero. If you attempt this, the method produces
	* a zero matrix instead.
	*
	* @return {Matrix3} A reference to this matrix.
	*/
	invert() {
		const te = this.elements, n11 = te[0], n21 = te[1], n31 = te[2], n12 = te[3], n22 = te[4], n32 = te[5], n13 = te[6], n23 = te[7], n33 = te[8], t11 = n33 * n22 - n32 * n23, t12 = n32 * n13 - n33 * n12, t13 = n23 * n12 - n22 * n13, det = n11 * t11 + n21 * t12 + n31 * t13;
		if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0);
		const detInv = 1 / det;
		te[0] = t11 * detInv;
		te[1] = (n31 * n23 - n33 * n21) * detInv;
		te[2] = (n32 * n21 - n31 * n22) * detInv;
		te[3] = t12 * detInv;
		te[4] = (n33 * n11 - n31 * n13) * detInv;
		te[5] = (n31 * n12 - n32 * n11) * detInv;
		te[6] = t13 * detInv;
		te[7] = (n21 * n13 - n23 * n11) * detInv;
		te[8] = (n22 * n11 - n21 * n12) * detInv;
		return this;
	}
	/**
	* Transposes this matrix in place.
	*
	* @return {Matrix3} A reference to this matrix.
	*/
	transpose() {
		let tmp;
		const m = this.elements;
		tmp = m[1];
		m[1] = m[3];
		m[3] = tmp;
		tmp = m[2];
		m[2] = m[6];
		m[6] = tmp;
		tmp = m[5];
		m[5] = m[7];
		m[7] = tmp;
		return this;
	}
	/**
	* Computes the normal matrix which is the inverse transpose of the upper
	* left 3x3 portion of the given 4x4 matrix.
	*
	* @param {Matrix4} matrix4 - The 4x4 matrix.
	* @return {Matrix3} A reference to this matrix.
	*/
	getNormalMatrix(matrix4) {
		return this.setFromMatrix4(matrix4).invert().transpose();
	}
	/**
	* Transposes this matrix into the supplied array, and returns itself unchanged.
	*
	* @param {Array<number>} r - An array to store the transposed matrix elements.
	* @return {Matrix3} A reference to this matrix.
	*/
	transposeIntoArray(r) {
		const m = this.elements;
		r[0] = m[0];
		r[1] = m[3];
		r[2] = m[6];
		r[3] = m[1];
		r[4] = m[4];
		r[5] = m[7];
		r[6] = m[2];
		r[7] = m[5];
		r[8] = m[8];
		return this;
	}
	/**
	* Sets the UV transform matrix from offset, repeat, rotation, and center.
	*
	* @param {number} tx - Offset x.
	* @param {number} ty - Offset y.
	* @param {number} sx - Repeat x.
	* @param {number} sy - Repeat y.
	* @param {number} rotation - Rotation, in radians. Positive values rotate counterclockwise.
	* @param {number} cx - Center x of rotation.
	* @param {number} cy - Center y of rotation
	* @return {Matrix3} A reference to this matrix.
	*/
	setUvTransform(tx, ty, sx, sy, rotation, cx, cy) {
		const c = Math.cos(rotation);
		const s = Math.sin(rotation);
		this.set(sx * c, sx * s, -sx * (c * cx + s * cy) + cx + tx, -sy * s, sy * c, -sy * (-s * cx + c * cy) + cy + ty, 0, 0, 1);
		return this;
	}
	/**
	* Scales this matrix with the given scalar values.
	*
	* @deprecated
	* @param {number} sx - The amount to scale in the X axis.
	* @param {number} sy - The amount to scale in the Y axis.
	* @return {Matrix3} A reference to this matrix.
	*/
	scale(sx, sy) {
		warnOnce("Matrix3: .scale() is deprecated. Use .makeScale() instead.");
		this.premultiply(_m3.makeScale(sx, sy));
		return this;
	}
	/**
	* Rotates this matrix by the given angle.
	*
	* @deprecated
	* @param {number} theta - The rotation in radians.
	* @return {Matrix3} A reference to this matrix.
	*/
	rotate(theta) {
		warnOnce("Matrix3: .rotate() is deprecated. Use .makeRotation() instead.");
		this.premultiply(_m3.makeRotation(-theta));
		return this;
	}
	/**
	* Translates this matrix by the given scalar values.
	*
	* @deprecated
	* @param {number} tx - The amount to translate in the X axis.
	* @param {number} ty - The amount to translate in the Y axis.
	* @return {Matrix3} A reference to this matrix.
	*/
	translate(tx, ty) {
		warnOnce("Matrix3: .translate() is deprecated. Use .makeTranslation() instead.");
		this.premultiply(_m3.makeTranslation(tx, ty));
		return this;
	}
	/**
	* Sets this matrix as a 2D translation transform.
	*
	* @param {number|Vector2} x - The amount to translate in the X axis or alternatively a translation vector.
	* @param {number} y - The amount to translate in the Y axis.
	* @return {Matrix3} A reference to this matrix.
	*/
	makeTranslation(x, y) {
		if (x.isVector2) this.set(1, 0, x.x, 0, 1, x.y, 0, 0, 1);
		else this.set(1, 0, x, 0, 1, y, 0, 0, 1);
		return this;
	}
	/**
	* Sets this matrix as a 2D rotational transformation.
	*
	* @param {number} theta - The rotation in radians.
	* @return {Matrix3} A reference to this matrix.
	*/
	makeRotation(theta) {
		const c = Math.cos(theta);
		const s = Math.sin(theta);
		this.set(c, -s, 0, s, c, 0, 0, 0, 1);
		return this;
	}
	/**
	* Sets this matrix as a 2D scale transform.
	*
	* @param {number} x - The amount to scale in the X axis.
	* @param {number} y - The amount to scale in the Y axis.
	* @return {Matrix3} A reference to this matrix.
	*/
	makeScale(x, y) {
		this.set(x, 0, 0, 0, y, 0, 0, 0, 1);
		return this;
	}
	/**
	* Returns `true` if this matrix is equal with the given one.
	*
	* @param {Matrix3} matrix - The matrix to test for equality.
	* @return {boolean} Whether this matrix is equal with the given one.
	*/
	equals(matrix) {
		const te = this.elements;
		const me = matrix.elements;
		for (let i = 0; i < 9; i++) if (te[i] !== me[i]) return false;
		return true;
	}
	/**
	* Sets the elements of the matrix from the given array.
	*
	* @param {Array<number>} array - The matrix elements in column-major order.
	* @param {number} [offset=0] - Index of the first element in the array.
	* @return {Matrix3} A reference to this matrix.
	*/
	fromArray(array, offset = 0) {
		for (let i = 0; i < 9; i++) this.elements[i] = array[i + offset];
		return this;
	}
	/**
	* Writes the elements of this matrix to the given array. If no array is provided,
	* the method returns a new instance.
	*
	* @param {Array<number>} [array=[]] - The target array holding the matrix elements in column-major order.
	* @param {number} [offset=0] - Index of the first element in the array.
	* @return {Array<number>} The matrix elements in column-major order.
	*/
	toArray(array = [], offset = 0) {
		const te = this.elements;
		array[offset] = te[0];
		array[offset + 1] = te[1];
		array[offset + 2] = te[2];
		array[offset + 3] = te[3];
		array[offset + 4] = te[4];
		array[offset + 5] = te[5];
		array[offset + 6] = te[6];
		array[offset + 7] = te[7];
		array[offset + 8] = te[8];
		return array;
	}
	/**
	* Returns a matrix with copied values from this instance.
	*
	* @return {Matrix3} A clone of this instance.
	*/
	clone() {
		return new this.constructor().fromArray(this.elements);
	}
};
const _m3 = /*@__PURE__*/ new Matrix3();
const LINEAR_REC709_TO_XYZ = /*@__PURE__*/ new Matrix3().set(.4123908, .3575843, .1804808, .212639, .7151687, .0721923, .0193308, .1191948, .9505322);
const XYZ_TO_LINEAR_REC709 = /*@__PURE__*/ new Matrix3().set(3.2409699, -1.5373832, -.4986108, -.9692436, 1.8759675, .0415551, .0556301, -.203977, 1.0569715);
function createColorManagement() {
	const ColorManagement = {
		enabled: true,
		workingColorSpace: LinearSRGBColorSpace,
		/**
		* Implementations of supported color spaces.
		*
		* Required:
		*	- primaries: chromaticity coordinates [ rx ry gx gy bx by ]
		*	- whitePoint: reference white [ x y ]
		*	- transfer: transfer function (pre-defined)
		*	- toXYZ: Matrix3 RGB to XYZ transform
		*	- fromXYZ: Matrix3 XYZ to RGB transform
		*	- luminanceCoefficients: RGB luminance coefficients
		*
		* Optional:
		*  - outputColorSpaceConfig: { drawingBufferColorSpace: ColorSpace, toneMappingMode: 'extended' | 'standard' }
		*  - workingColorSpaceConfig: { unpackColorSpace: ColorSpace }
		*
		* Reference:
		* - https://www.russellcottrell.com/photo/matrixCalculator.htm
		*/
		spaces: {},
		convert: function(color, sourceColorSpace, targetColorSpace) {
			if (this.enabled === false || sourceColorSpace === targetColorSpace || !sourceColorSpace || !targetColorSpace) return color;
			if (this.spaces[sourceColorSpace].transfer === "srgb") {
				color.r = SRGBToLinear(color.r);
				color.g = SRGBToLinear(color.g);
				color.b = SRGBToLinear(color.b);
			}
			if (this.spaces[sourceColorSpace].primaries !== this.spaces[targetColorSpace].primaries) {
				color.applyMatrix3(this.spaces[sourceColorSpace].toXYZ);
				color.applyMatrix3(this.spaces[targetColorSpace].fromXYZ);
			}
			if (this.spaces[targetColorSpace].transfer === "srgb") {
				color.r = LinearToSRGB(color.r);
				color.g = LinearToSRGB(color.g);
				color.b = LinearToSRGB(color.b);
			}
			return color;
		},
		workingToColorSpace: function(color, targetColorSpace) {
			return this.convert(color, this.workingColorSpace, targetColorSpace);
		},
		colorSpaceToWorking: function(color, sourceColorSpace) {
			return this.convert(color, sourceColorSpace, this.workingColorSpace);
		},
		getPrimaries: function(colorSpace) {
			return this.spaces[colorSpace].primaries;
		},
		getTransfer: function(colorSpace) {
			if (colorSpace === "") return LinearTransfer;
			return this.spaces[colorSpace].transfer;
		},
		getToneMappingMode: function(colorSpace) {
			return this.spaces[colorSpace].outputColorSpaceConfig.toneMappingMode || "standard";
		},
		getLuminanceCoefficients: function(target, colorSpace = this.workingColorSpace) {
			return target.fromArray(this.spaces[colorSpace].luminanceCoefficients);
		},
		define: function(colorSpaces) {
			Object.assign(this.spaces, colorSpaces);
		},
		_getMatrix: function(targetMatrix, sourceColorSpace, targetColorSpace) {
			return targetMatrix.copy(this.spaces[sourceColorSpace].toXYZ).multiply(this.spaces[targetColorSpace].fromXYZ);
		},
		_getDrawingBufferColorSpace: function(colorSpace) {
			return this.spaces[colorSpace].outputColorSpaceConfig.drawingBufferColorSpace;
		},
		_getUnpackColorSpace: function(colorSpace = this.workingColorSpace) {
			return this.spaces[colorSpace].workingColorSpaceConfig.unpackColorSpace;
		},
		fromWorkingColorSpace: function(color, targetColorSpace) {
			warnOnce("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace().");
			return ColorManagement.workingToColorSpace(color, targetColorSpace);
		},
		toWorkingColorSpace: function(color, sourceColorSpace) {
			warnOnce("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking().");
			return ColorManagement.colorSpaceToWorking(color, sourceColorSpace);
		}
	};
	/******************************************************************************
	* sRGB definitions
	*/
	const REC709_PRIMARIES = [
		.64,
		.33,
		.3,
		.6,
		.15,
		.06
	];
	const REC709_LUMINANCE_COEFFICIENTS = [
		.2126,
		.7152,
		.0722
	];
	const D65 = [.3127, .329];
	ColorManagement.define({
		[LinearSRGBColorSpace]: {
			primaries: REC709_PRIMARIES,
			whitePoint: D65,
			transfer: LinearTransfer,
			toXYZ: LINEAR_REC709_TO_XYZ,
			fromXYZ: XYZ_TO_LINEAR_REC709,
			luminanceCoefficients: REC709_LUMINANCE_COEFFICIENTS,
			workingColorSpaceConfig: { unpackColorSpace: SRGBColorSpace },
			outputColorSpaceConfig: { drawingBufferColorSpace: SRGBColorSpace }
		},
		[SRGBColorSpace]: {
			primaries: REC709_PRIMARIES,
			whitePoint: D65,
			transfer: SRGBTransfer,
			toXYZ: LINEAR_REC709_TO_XYZ,
			fromXYZ: XYZ_TO_LINEAR_REC709,
			luminanceCoefficients: REC709_LUMINANCE_COEFFICIENTS,
			outputColorSpaceConfig: { drawingBufferColorSpace: SRGBColorSpace }
		}
	});
	return ColorManagement;
}
const ColorManagement = /*@__PURE__*/ createColorManagement();
function SRGBToLinear(c) {
	return c < .04045 ? c * .0773993808 : Math.pow(c * .9478672986 + .0521327014, 2.4);
}
function LinearToSRGB(c) {
	return c < .0031308 ? c * 12.92 : 1.055 * Math.pow(c, .41666) - .055;
}
let _canvas;
/**
* A class containing utility functions for images.
*
* @hideconstructor
*/
var ImageUtils = class {
	/**
	* Returns a data URI containing a representation of the given image.
	*
	* @param {(HTMLImageElement|HTMLCanvasElement)} image - The image object.
	* @param {string} [type='image/png'] - Indicates the image format.
	* @return {string} The data URI.
	*/
	static getDataURL(image, type = "image/png") {
		if (/^data:/i.test(image.src)) return image.src;
		if (typeof HTMLCanvasElement === "undefined") return image.src;
		let canvas;
		if (image instanceof HTMLCanvasElement) canvas = image;
		else {
			if (_canvas === void 0) _canvas = createElementNS("canvas");
			_canvas.width = image.width;
			_canvas.height = image.height;
			const context = _canvas.getContext("2d");
			if (image instanceof ImageData) context.putImageData(image, 0, 0);
			else context.drawImage(image, 0, 0, image.width, image.height);
			canvas = _canvas;
		}
		return canvas.toDataURL(type);
	}
	/**
	* Converts the given sRGB image data to linear color space.
	*
	* @param {(HTMLImageElement|HTMLCanvasElement|ImageBitmap|Object)} image - The image object.
	* @return {HTMLCanvasElement|Object} The converted image.
	*/
	static sRGBToLinear(image) {
		if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement || typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement || typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
			const canvas = createElementNS("canvas");
			canvas.width = image.width;
			canvas.height = image.height;
			const context = canvas.getContext("2d");
			context.drawImage(image, 0, 0, image.width, image.height);
			const imageData = context.getImageData(0, 0, image.width, image.height);
			const data = imageData.data;
			for (let i = 0; i < data.length; i++) data[i] = SRGBToLinear(data[i] / 255) * 255;
			context.putImageData(imageData, 0, 0);
			return canvas;
		} else if (image.data) {
			const data = image.data.slice(0);
			for (let i = 0; i < data.length; i++) if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) data[i] = Math.floor(SRGBToLinear(data[i] / 255) * 255);
			else data[i] = SRGBToLinear(data[i]);
			return {
				data,
				width: image.width,
				height: image.height
			};
		} else {
			warn("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied.");
			return image;
		}
	}
};
let _sourceId = 0;
/**
* Represents the data source of a texture.
*
* The main purpose of this class is to decouple the data definition from the texture
* definition so the same data can be used with multiple texture instances.
*/
var Source = class {
	/**
	* Constructs a new video texture.
	*
	* @param {any} [data=null] - The data definition of a texture.
	*/
	constructor(data = null) {
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isSource = true;
		/**
		* The ID of the source.
		*
		* @name Source#id
		* @type {number}
		* @readonly
		*/
		Object.defineProperty(this, "id", { value: _sourceId++ });
		/**
		* The UUID of the source.
		*
		* @type {string}
		* @readonly
		*/
		this.uuid = generateUUID();
		/**
		* The data definition of a texture.
		*
		* @type {any}
		*/
		this.data = data;
		/**
		* This property is only relevant when {@link Source#needsUpdate} is set to `true` and
		* provides more control on how texture data should be processed. When `dataReady` is set
		* to `false`, the engine performs the memory allocation (if necessary) but does not transfer
		* the data into the GPU memory.
		*
		* @type {boolean}
		* @default true
		*/
		this.dataReady = true;
		/**
		* This starts at `0` and counts how many times {@link Source#needsUpdate} is set to `true`.
		*
		* @type {number}
		* @readonly
		* @default 0
		*/
		this.version = 0;
	}
	/**
	* Returns the dimensions of the source into the given target vector.
	*
	* @param {(Vector2|Vector3)} target - The target object the result is written into.
	* @return {(Vector2|Vector3)} The dimensions of the source.
	*/
	getSize(target) {
		const data = this.data;
		if (typeof HTMLVideoElement !== "undefined" && data instanceof HTMLVideoElement) target.set(data.videoWidth, data.videoHeight, 0);
		else if (typeof VideoFrame !== "undefined" && data instanceof VideoFrame) target.set(data.displayWidth, data.displayHeight, 0);
		else if (data !== null) target.set(data.width, data.height, data.depth || 0);
		else target.set(0, 0, 0);
		return target;
	}
	/**
	* When the property is set to `true`, the engine allocates the memory
	* for the texture (if necessary) and triggers the actual texture upload
	* to the GPU next time the source is used.
	*
	* @type {boolean}
	* @default false
	* @param {boolean} value
	*/
	set needsUpdate(value) {
		if (value === true) this.version++;
	}
	/**
	* Serializes the source into JSON.
	*
	* @param {?(Object|string)} meta - An optional value holding meta information about the serialization.
	* @return {Object} A JSON object representing the serialized source.
	* @see {@link ObjectLoader#parse}
	*/
	toJSON(meta) {
		const isRootObject = meta === void 0 || typeof meta === "string";
		if (!isRootObject && meta.images[this.uuid] !== void 0) return meta.images[this.uuid];
		const output = {
			uuid: this.uuid,
			url: ""
		};
		const data = this.data;
		if (data !== null) {
			let url;
			if (Array.isArray(data)) {
				url = [];
				for (let i = 0, l = data.length; i < l; i++) if (data[i].isDataTexture) url.push(serializeImage(data[i].image));
				else url.push(serializeImage(data[i]));
			} else url = serializeImage(data);
			output.url = url;
		}
		if (!isRootObject) meta.images[this.uuid] = output;
		return output;
	}
};
function serializeImage(image) {
	if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement || typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement || typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) return ImageUtils.getDataURL(image);
	else if (image.data) return {
		data: Array.from(image.data),
		width: image.width,
		height: image.height,
		type: image.data.constructor.name
	};
	else {
		warn("Texture: Unable to serialize Texture.");
		return {};
	}
}
let _textureId = 0;
const _tempVec3 = /*@__PURE__*/ new Vector3();
/**
* Base class for all textures.
*
* Note: After the initial use of a texture, its dimensions, format, and type
* cannot be changed. Instead, call {@link Texture#dispose} on the texture and instantiate a new one.
*
* @augments EventDispatcher
*/
var Texture = class Texture extends EventDispatcher {
	/**
	* Constructs a new texture.
	*
	* @param {?Object} [image=Texture.DEFAULT_IMAGE] - The image holding the texture data.
	* @param {number} [mapping=Texture.DEFAULT_MAPPING] - The texture mapping.
	* @param {number} [wrapS=ClampToEdgeWrapping] - The wrapS value.
	* @param {number} [wrapT=ClampToEdgeWrapping] - The wrapT value.
	* @param {number} [magFilter=LinearFilter] - The mag filter value.
	* @param {number} [minFilter=LinearMipmapLinearFilter] - The min filter value.
	* @param {number} [format=RGBAFormat] - The texture format.
	* @param {number} [type=UnsignedByteType] - The texture type.
	* @param {number} [anisotropy=Texture.DEFAULT_ANISOTROPY] - The anisotropy value.
	* @param {string} [colorSpace=NoColorSpace] - The color space.
	*/
	constructor(image = Texture.DEFAULT_IMAGE, mapping = Texture.DEFAULT_MAPPING, wrapS = ClampToEdgeWrapping, wrapT = ClampToEdgeWrapping, magFilter = LinearFilter, minFilter = LinearMipmapLinearFilter, format = RGBAFormat, type = UnsignedByteType, anisotropy = Texture.DEFAULT_ANISOTROPY, colorSpace = "") {
		super();
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isTexture = true;
		/**
		* The ID of the texture.
		*
		* @name Texture#id
		* @type {number}
		* @readonly
		*/
		Object.defineProperty(this, "id", { value: _textureId++ });
		/**
		* The UUID of the texture.
		*
		* @type {string}
		* @readonly
		*/
		this.uuid = generateUUID();
		/**
		* The name of the texture.
		*
		* @type {string}
		*/
		this.name = "";
		/**
		* The data definition of a texture. A reference to the data source can be
		* shared across textures. This is often useful in context of spritesheets
		* where multiple textures render the same data but with different texture
		* transformations.
		*
		* @type {Source}
		*/
		this.source = new Source(image);
		/**
		* An array holding user-defined mipmaps.
		*
		* @type {Array<Object>}
		*/
		this.mipmaps = [];
		/**
		* How the texture is applied to the object. The value `UVMapping`
		* is the default, where texture or uv coordinates are used to apply the map.
		*
		* @type {(UVMapping|CubeReflectionMapping|CubeRefractionMapping|EquirectangularReflectionMapping|EquirectangularRefractionMapping|CubeUVReflectionMapping)}
		* @default UVMapping
		*/
		this.mapping = mapping;
		/**
		* Lets you select the uv attribute to map the texture to. `0` for `uv`,
		* `1` for `uv1`, `2` for `uv2` and `3` for `uv3`.
		*
		* @type {number}
		* @default 0
		*/
		this.channel = 0;
		/**
		* This defines how the texture is wrapped horizontally and corresponds to
		* *U* in UV mapping.
		*
		* @type {(RepeatWrapping|ClampToEdgeWrapping|MirroredRepeatWrapping)}
		* @default ClampToEdgeWrapping
		*/
		this.wrapS = wrapS;
		/**
		* This defines how the texture is wrapped horizontally and corresponds to
		* *V* in UV mapping.
		*
		* @type {(RepeatWrapping|ClampToEdgeWrapping|MirroredRepeatWrapping)}
		* @default ClampToEdgeWrapping
		*/
		this.wrapT = wrapT;
		/**
		* How the texture is sampled when a texel covers more than one pixel.
		*
		* @type {(NearestFilter|NearestMipmapNearestFilter|NearestMipmapLinearFilter|LinearFilter|LinearMipmapNearestFilter|LinearMipmapLinearFilter)}
		* @default LinearFilter
		*/
		this.magFilter = magFilter;
		/**
		* How the texture is sampled when a texel covers less than one pixel.
		*
		* @type {(NearestFilter|NearestMipmapNearestFilter|NearestMipmapLinearFilter|LinearFilter|LinearMipmapNearestFilter|LinearMipmapLinearFilter)}
		* @default LinearMipmapLinearFilter
		*/
		this.minFilter = minFilter;
		/**
		* The number of samples taken along the axis through the pixel that has the
		* highest density of texels. By default, this value is `1`. A higher value
		* gives a less blurry result than a basic mipmap, at the cost of more
		* texture samples being used.
		*
		* @type {number}
		* @default Texture.DEFAULT_ANISOTROPY
		*/
		this.anisotropy = anisotropy;
		/**
		* The format of the texture.
		*
		* @type {number}
		* @default RGBAFormat
		*/
		this.format = format;
		/**
		* The default internal format is derived from {@link Texture#format} and {@link Texture#type} and
		* defines how the texture data is going to be stored on the GPU.
		*
		* This property allows to overwrite the default format.
		*
		* @type {?string}
		* @default null
		*/
		this.internalFormat = null;
		/**
		* The data type of the texture.
		*
		* @type {number}
		* @default UnsignedByteType
		*/
		this.type = type;
		/**
		* How much a single repetition of the texture is offset from the beginning,
		* in each direction U and V. Typical range is `0.0` to `1.0`.
		*
		* @type {Vector2}
		* @default (0,0)
		*/
		this.offset = new Vector2(0, 0);
		/**
		* How many times the texture is repeated across the surface, in each
		* direction U and V. If repeat is set greater than `1` in either direction,
		* the corresponding wrap parameter should also be set to `RepeatWrapping`
		* or `MirroredRepeatWrapping` to achieve the desired tiling effect.
		*
		* @type {Vector2}
		* @default (1,1)
		*/
		this.repeat = new Vector2(1, 1);
		/**
		* The point around which rotation occurs. A value of `(0.5, 0.5)` corresponds
		* to the center of the texture. Default is `(0, 0)`, the lower left.
		*
		* @type {Vector2}
		* @default (0,0)
		*/
		this.center = new Vector2(0, 0);
		/**
		* How much the texture is rotated around the center point, in radians.
		* Positive values are counter-clockwise.
		*
		* @type {number}
		* @default 0
		*/
		this.rotation = 0;
		/**
		* Whether to update the texture's uv-transformation {@link Texture#matrix}
		* from the properties {@link Texture#offset}, {@link Texture#repeat},
		* {@link Texture#rotation}, and {@link Texture#center}.
		*
		* Set this to `false` if you are specifying the uv-transform matrix directly.
		*
		* @type {boolean}
		* @default true
		*/
		this.matrixAutoUpdate = true;
		/**
		* The uv-transformation matrix of the texture.
		*
		* @type {Matrix3}
		*/
		this.matrix = new Matrix3();
		/**
		* Whether to generate mipmaps (if possible) for a texture.
		*
		* Set this to `false` if you are creating mipmaps manually.
		*
		* @type {boolean}
		* @default true
		*/
		this.generateMipmaps = true;
		/**
		* If set to `true`, the alpha channel, if present, is multiplied into the
		* color channels when the texture is uploaded to the GPU.
		*
		* Note that this property has no effect when using `ImageBitmap`. You need to
		* configure premultiply alpha on bitmap creation instead.
		*
		* @type {boolean}
		* @default false
		*/
		this.premultiplyAlpha = false;
		/**
		* If set to `true`, the texture is flipped along the vertical axis when
		* uploaded to the GPU.
		*
		* Note that this property has no effect when using `ImageBitmap`. You need to
		* configure the flip on bitmap creation instead.
		*
		* @type {boolean}
		* @default true
		*/
		this.flipY = true;
		/**
		* Specifies the alignment requirements for the start of each pixel row in memory.
		* The allowable values are `1` (byte-alignment), `2` (rows aligned to even-numbered bytes),
		* `4` (word-alignment), and `8` (rows start on double-word boundaries).
		*
		* @type {number}
		* @default 4
		*/
		this.unpackAlignment = 4;
		/**
		* Textures containing color data should be annotated with `SRGBColorSpace` or `LinearSRGBColorSpace`.
		*
		* @type {string}
		* @default NoColorSpace
		*/
		this.colorSpace = colorSpace;
		/**
		* An object that can be used to store custom data about the texture. It
		* should not hold references to functions as these will not be cloned.
		*
		* @type {Object}
		*/
		this.userData = {};
		/**
		* This can be used to only update a subregion or specific rows of the texture (for example, just the
		* first 3 rows). Use the `addUpdateRange()` function to add ranges to this array.
		*
		* @type {Array<Object>}
		*/
		this.updateRanges = [];
		/**
		* This starts at `0` and counts how many times {@link Texture#needsUpdate} is set to `true`.
		*
		* @type {number}
		* @readonly
		* @default 0
		*/
		this.version = 0;
		/**
		* A callback function, called when the texture is updated (e.g., when
		* {@link Texture#needsUpdate} has been set to true and then the texture is used).
		*
		* @type {?Function}
		* @default null
		*/
		this.onUpdate = null;
		/**
		* An optional back reference to the textures render target.
		*
		* @type {?(RenderTarget|WebGLRenderTarget)}
		* @default null
		*/
		this.renderTarget = null;
		/**
		* Indicates whether a texture belongs to a render target or not.
		*
		* @type {boolean}
		* @readonly
		* @default false
		*/
		this.isRenderTargetTexture = false;
		/**
		* Indicates if a texture should be handled like a texture array.
		*
		* @type {boolean}
		* @readonly
		* @default false
		*/
		this.isArrayTexture = image && image.depth && image.depth > 1 ? true : false;
		/**
		* Indicates whether this texture should be processed by `PMREMGenerator` or not
		* (only relevant for render target textures).
		*
		* @type {number}
		* @readonly
		* @default 0
		*/
		this.pmremVersion = 0;
		/**
		* Whether the texture should use one of the 16 bit integer formats which are normalized
		* to [0, 1] or [-1, 1] (depending on signed/unsigned) when sampled.
		*
		* @type {boolean}
		* @default false
		*/
		this.normalized = false;
	}
	/**
	* The width of the texture in pixels.
	*/
	get width() {
		return this.source.getSize(_tempVec3).x;
	}
	/**
	* The height of the texture in pixels.
	*/
	get height() {
		return this.source.getSize(_tempVec3).y;
	}
	/**
	* The depth of the texture in pixels.
	*/
	get depth() {
		return this.source.getSize(_tempVec3).z;
	}
	/**
	* The image object holding the texture data.
	*
	* @type {?Object}
	*/
	get image() {
		return this.source.data;
	}
	set image(value) {
		this.source.data = value;
	}
	/**
	* Updates the texture transformation matrix from the properties {@link Texture#offset},
	* {@link Texture#repeat}, {@link Texture#rotation}, and {@link Texture#center}.
	*/
	updateMatrix() {
		this.matrix.setUvTransform(this.offset.x, this.offset.y, this.repeat.x, this.repeat.y, this.rotation, this.center.x, this.center.y);
	}
	/**
	* Adds a range of data in the data texture to be updated on the GPU.
	*
	* @param {number} start - Position at which to start update.
	* @param {number} count - The number of components to update.
	*/
	addUpdateRange(start, count) {
		this.updateRanges.push({
			start,
			count
		});
	}
	/**
	* Clears the update ranges.
	*/
	clearUpdateRanges() {
		this.updateRanges.length = 0;
	}
	/**
	* Returns a new texture with copied values from this instance.
	*
	* @return {Texture} A clone of this instance.
	*/
	clone() {
		return new this.constructor().copy(this);
	}
	/**
	* Copies the values of the given texture to this instance.
	*
	* @param {Texture} source - The texture to copy.
	* @return {Texture} A reference to this instance.
	*/
	copy(source) {
		this.name = source.name;
		this.source = source.source;
		this.mipmaps = source.mipmaps.slice(0);
		this.mapping = source.mapping;
		this.channel = source.channel;
		this.wrapS = source.wrapS;
		this.wrapT = source.wrapT;
		this.magFilter = source.magFilter;
		this.minFilter = source.minFilter;
		this.anisotropy = source.anisotropy;
		this.format = source.format;
		this.internalFormat = source.internalFormat;
		this.type = source.type;
		this.normalized = source.normalized;
		this.offset.copy(source.offset);
		this.repeat.copy(source.repeat);
		this.center.copy(source.center);
		this.rotation = source.rotation;
		this.matrixAutoUpdate = source.matrixAutoUpdate;
		this.matrix.copy(source.matrix);
		this.generateMipmaps = source.generateMipmaps;
		this.premultiplyAlpha = source.premultiplyAlpha;
		this.flipY = source.flipY;
		this.unpackAlignment = source.unpackAlignment;
		this.colorSpace = source.colorSpace;
		this.renderTarget = source.renderTarget;
		this.isRenderTargetTexture = source.isRenderTargetTexture;
		this.isArrayTexture = source.isArrayTexture;
		this.userData = JSON.parse(JSON.stringify(source.userData));
		this.needsUpdate = true;
		return this;
	}
	/**
	* Sets this texture's properties based on `values`.
	* @param {Object} values - A container with texture parameters.
	*/
	setValues(values) {
		for (const key in values) {
			const newValue = values[key];
			if (newValue === void 0) {
				warn(`Texture.setValues(): parameter '${key}' has value of undefined.`);
				continue;
			}
			const currentValue = this[key];
			if (currentValue === void 0) {
				warn(`Texture.setValues(): property '${key}' does not exist.`);
				continue;
			}
			if (currentValue && newValue && currentValue.isVector2 && newValue.isVector2) currentValue.copy(newValue);
			else if (currentValue && newValue && currentValue.isVector3 && newValue.isVector3) currentValue.copy(newValue);
			else if (currentValue && newValue && currentValue.isMatrix3 && newValue.isMatrix3) currentValue.copy(newValue);
			else this[key] = newValue;
		}
	}
	/**
	* Serializes the texture into JSON.
	*
	* @param {?(Object|string)} meta - An optional value holding meta information about the serialization.
	* @return {Object} A JSON object representing the serialized texture.
	* @see {@link ObjectLoader#parse}
	*/
	toJSON(meta) {
		const isRootObject = meta === void 0 || typeof meta === "string";
		if (!isRootObject && meta.textures[this.uuid] !== void 0) return meta.textures[this.uuid];
		const output = {
			metadata: {
				version: 4.7,
				type: "Texture",
				generator: "Texture.toJSON"
			},
			uuid: this.uuid,
			name: this.name,
			image: this.source.toJSON(meta).uuid,
			mapping: this.mapping,
			channel: this.channel,
			repeat: [this.repeat.x, this.repeat.y],
			offset: [this.offset.x, this.offset.y],
			center: [this.center.x, this.center.y],
			rotation: this.rotation,
			wrap: [this.wrapS, this.wrapT],
			format: this.format,
			internalFormat: this.internalFormat,
			type: this.type,
			normalized: this.normalized,
			colorSpace: this.colorSpace,
			minFilter: this.minFilter,
			magFilter: this.magFilter,
			anisotropy: this.anisotropy,
			flipY: this.flipY,
			generateMipmaps: this.generateMipmaps,
			premultiplyAlpha: this.premultiplyAlpha,
			unpackAlignment: this.unpackAlignment
		};
		if (Object.keys(this.userData).length > 0) output.userData = this.userData;
		if (!isRootObject) meta.textures[this.uuid] = output;
		return output;
	}
	/**
	* Frees the GPU-related resources allocated by this instance. Call this
	* method whenever this instance is no longer used in your app.
	*
	* @fires Texture#dispose
	*/
	dispose() {
		/**
		* Fires when the texture has been disposed of.
		*
		* @event Texture#dispose
		* @type {Object}
		*/
		this.dispatchEvent({ type: "dispose" });
	}
	/**
	* Transforms the given uv vector with the textures uv transformation matrix.
	*
	* @param {Vector2} uv - The uv vector.
	* @return {Vector2} The transformed uv vector.
	*/
	transformUv(uv) {
		if (this.mapping !== 300) return uv;
		uv.applyMatrix3(this.matrix);
		if (uv.x < 0 || uv.x > 1) switch (this.wrapS) {
			case RepeatWrapping:
				uv.x = uv.x - Math.floor(uv.x);
				break;
			case ClampToEdgeWrapping:
				uv.x = uv.x < 0 ? 0 : 1;
				break;
			case MirroredRepeatWrapping: if (Math.abs(Math.floor(uv.x) % 2) === 1) uv.x = Math.ceil(uv.x) - uv.x;
			else uv.x = uv.x - Math.floor(uv.x);
		}
		if (uv.y < 0 || uv.y > 1) switch (this.wrapT) {
			case RepeatWrapping:
				uv.y = uv.y - Math.floor(uv.y);
				break;
			case ClampToEdgeWrapping:
				uv.y = uv.y < 0 ? 0 : 1;
				break;
			case MirroredRepeatWrapping: if (Math.abs(Math.floor(uv.y) % 2) === 1) uv.y = Math.ceil(uv.y) - uv.y;
			else uv.y = uv.y - Math.floor(uv.y);
		}
		if (this.flipY) uv.y = 1 - uv.y;
		return uv;
	}
	/**
	* Setting this property to `true` indicates the engine the texture
	* must be updated in the next render. This triggers a texture upload
	* to the GPU and ensures correct texture parameter configuration.
	*
	* @type {boolean}
	* @default false
	* @param {boolean} value
	*/
	set needsUpdate(value) {
		if (value === true) {
			this.version++;
			this.source.needsUpdate = true;
		}
	}
	/**
	* Setting this property to `true` indicates the engine the PMREM
	* must be regenerated.
	*
	* @type {boolean}
	* @default false
	* @param {boolean} value
	*/
	set needsPMREMUpdate(value) {
		if (value === true) this.pmremVersion++;
	}
};
/**
* The default image for all textures.
*
* @static
* @type {?Image}
* @default null
*/
Texture.DEFAULT_IMAGE = null;
/**
* The default mapping for all textures.
*
* @static
* @type {number}
* @default UVMapping
*/
Texture.DEFAULT_MAPPING = 300;
/**
* The default anisotropy value for all textures.
*
* @static
* @type {number}
* @default 1
*/
Texture.DEFAULT_ANISOTROPY = 1;
/**
* Class representing a 4D vector. A 4D vector is an ordered quadruplet of numbers
* (labeled x, y, z and w), which can be used to represent a number of things, such as:
*
* - A point in 4D space.
* - A direction and length in 4D space. In three.js the length will
* always be the Euclidean distance(straight-line distance) from `(0, 0, 0, 0)` to `(x, y, z, w)`
* and the direction is also measured from `(0, 0, 0, 0)` towards `(x, y, z, w)`.
* - Any arbitrary ordered quadruplet of numbers.
*
* There are other things a 4D vector can be used to represent, however these
* are the most common uses in *three.js*.
*
* Iterating through a vector instance will yield its components `(x, y, z, w)` in
* the corresponding order.
* ```js
* const a = new THREE.Vector4( 0, 1, 0, 0 );
*
* //no arguments; will be initialised to (0, 0, 0, 1)
* const b = new THREE.Vector4( );
*
* const d = a.dot( b );
* ```
*/
var Vector4 = class Vector4 {
	static {
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		Vector4.prototype.isVector4 = true;
	}
	/**
	* Constructs a new 4D vector.
	*
	* @param {number} [x=0] - The x value of this vector.
	* @param {number} [y=0] - The y value of this vector.
	* @param {number} [z=0] - The z value of this vector.
	* @param {number} [w=1] - The w value of this vector.
	*/
	constructor(x = 0, y = 0, z = 0, w = 1) {
		/**
		* The x value of this vector.
		*
		* @type {number}
		*/
		this.x = x;
		/**
		* The y value of this vector.
		*
		* @type {number}
		*/
		this.y = y;
		/**
		* The z value of this vector.
		*
		* @type {number}
		*/
		this.z = z;
		/**
		* The w value of this vector.
		*
		* @type {number}
		*/
		this.w = w;
	}
	/**
	* Alias for {@link Vector4#z}.
	*
	* @type {number}
	*/
	get width() {
		return this.z;
	}
	set width(value) {
		this.z = value;
	}
	/**
	* Alias for {@link Vector4#w}.
	*
	* @type {number}
	*/
	get height() {
		return this.w;
	}
	set height(value) {
		this.w = value;
	}
	/**
	* Sets the vector components.
	*
	* @param {number} x - The value of the x component.
	* @param {number} y - The value of the y component.
	* @param {number} z - The value of the z component.
	* @param {number} w - The value of the w component.
	* @return {Vector4} A reference to this vector.
	*/
	set(x, y, z, w) {
		this.x = x;
		this.y = y;
		this.z = z;
		this.w = w;
		return this;
	}
	/**
	* Sets the vector components to the same value.
	*
	* @param {number} scalar - The value to set for all vector components.
	* @return {Vector4} A reference to this vector.
	*/
	setScalar(scalar) {
		this.x = scalar;
		this.y = scalar;
		this.z = scalar;
		this.w = scalar;
		return this;
	}
	/**
	* Sets the vector's x component to the given value
	*
	* @param {number} x - The value to set.
	* @return {Vector4} A reference to this vector.
	*/
	setX(x) {
		this.x = x;
		return this;
	}
	/**
	* Sets the vector's y component to the given value
	*
	* @param {number} y - The value to set.
	* @return {Vector4} A reference to this vector.
	*/
	setY(y) {
		this.y = y;
		return this;
	}
	/**
	* Sets the vector's z component to the given value
	*
	* @param {number} z - The value to set.
	* @return {Vector4} A reference to this vector.
	*/
	setZ(z) {
		this.z = z;
		return this;
	}
	/**
	* Sets the vector's w component to the given value
	*
	* @param {number} w - The value to set.
	* @return {Vector4} A reference to this vector.
	*/
	setW(w) {
		this.w = w;
		return this;
	}
	/**
	* Allows to set a vector component with an index.
	*
	* @param {number} index - The component index. `0` equals to x, `1` equals to y,
	* `2` equals to z, `3` equals to w.
	* @param {number} value - The value to set.
	* @return {Vector4} A reference to this vector.
	*/
	setComponent(index, value) {
		switch (index) {
			case 0:
				this.x = value;
				break;
			case 1:
				this.y = value;
				break;
			case 2:
				this.z = value;
				break;
			case 3:
				this.w = value;
				break;
			default: throw new Error("THREE.Vector4: index is out of range: " + index);
		}
		return this;
	}
	/**
	* Returns the value of the vector component which matches the given index.
	*
	* @param {number} index - The component index. `0` equals to x, `1` equals to y,
	* `2` equals to z, `3` equals to w.
	* @return {number} A vector component value.
	*/
	getComponent(index) {
		switch (index) {
			case 0: return this.x;
			case 1: return this.y;
			case 2: return this.z;
			case 3: return this.w;
			default: throw new Error("THREE.Vector4: index is out of range: " + index);
		}
	}
	/**
	* Returns a new vector with copied values from this instance.
	*
	* @return {Vector4} A clone of this instance.
	*/
	clone() {
		return new this.constructor(this.x, this.y, this.z, this.w);
	}
	/**
	* Copies the values of the given vector to this instance.
	*
	* @param {Vector3|Vector4} v - The vector to copy.
	* @return {Vector4} A reference to this vector.
	*/
	copy(v) {
		this.x = v.x;
		this.y = v.y;
		this.z = v.z;
		this.w = v.w !== void 0 ? v.w : 1;
		return this;
	}
	/**
	* Adds the given vector to this instance.
	*
	* @param {Vector4} v - The vector to add.
	* @return {Vector4} A reference to this vector.
	*/
	add(v) {
		this.x += v.x;
		this.y += v.y;
		this.z += v.z;
		this.w += v.w;
		return this;
	}
	/**
	* Adds the given scalar value to all components of this instance.
	*
	* @param {number} s - The scalar to add.
	* @return {Vector4} A reference to this vector.
	*/
	addScalar(s) {
		this.x += s;
		this.y += s;
		this.z += s;
		this.w += s;
		return this;
	}
	/**
	* Adds the given vectors and stores the result in this instance.
	*
	* @param {Vector4} a - The first vector.
	* @param {Vector4} b - The second vector.
	* @return {Vector4} A reference to this vector.
	*/
	addVectors(a, b) {
		this.x = a.x + b.x;
		this.y = a.y + b.y;
		this.z = a.z + b.z;
		this.w = a.w + b.w;
		return this;
	}
	/**
	* Adds the given vector scaled by the given factor to this instance.
	*
	* @param {Vector4} v - The vector.
	* @param {number} s - The factor that scales `v`.
	* @return {Vector4} A reference to this vector.
	*/
	addScaledVector(v, s) {
		this.x += v.x * s;
		this.y += v.y * s;
		this.z += v.z * s;
		this.w += v.w * s;
		return this;
	}
	/**
	* Subtracts the given vector from this instance.
	*
	* @param {Vector4} v - The vector to subtract.
	* @return {Vector4} A reference to this vector.
	*/
	sub(v) {
		this.x -= v.x;
		this.y -= v.y;
		this.z -= v.z;
		this.w -= v.w;
		return this;
	}
	/**
	* Subtracts the given scalar value from all components of this instance.
	*
	* @param {number} s - The scalar to subtract.
	* @return {Vector4} A reference to this vector.
	*/
	subScalar(s) {
		this.x -= s;
		this.y -= s;
		this.z -= s;
		this.w -= s;
		return this;
	}
	/**
	* Subtracts the given vectors and stores the result in this instance.
	*
	* @param {Vector4} a - The first vector.
	* @param {Vector4} b - The second vector.
	* @return {Vector4} A reference to this vector.
	*/
	subVectors(a, b) {
		this.x = a.x - b.x;
		this.y = a.y - b.y;
		this.z = a.z - b.z;
		this.w = a.w - b.w;
		return this;
	}
	/**
	* Multiplies the given vector with this instance.
	*
	* @param {Vector4} v - The vector to multiply.
	* @return {Vector4} A reference to this vector.
	*/
	multiply(v) {
		this.x *= v.x;
		this.y *= v.y;
		this.z *= v.z;
		this.w *= v.w;
		return this;
	}
	/**
	* Multiplies the given scalar value with all components of this instance.
	*
	* @param {number} scalar - The scalar to multiply.
	* @return {Vector4} A reference to this vector.
	*/
	multiplyScalar(scalar) {
		this.x *= scalar;
		this.y *= scalar;
		this.z *= scalar;
		this.w *= scalar;
		return this;
	}
	/**
	* Multiplies this vector with the given 4x4 matrix.
	*
	* @param {Matrix4} m - The 4x4 matrix.
	* @return {Vector4} A reference to this vector.
	*/
	applyMatrix4(m) {
		const x = this.x, y = this.y, z = this.z, w = this.w;
		const e = m.elements;
		this.x = e[0] * x + e[4] * y + e[8] * z + e[12] * w;
		this.y = e[1] * x + e[5] * y + e[9] * z + e[13] * w;
		this.z = e[2] * x + e[6] * y + e[10] * z + e[14] * w;
		this.w = e[3] * x + e[7] * y + e[11] * z + e[15] * w;
		return this;
	}
	/**
	* Divides this instance by the given vector.
	*
	* @param {Vector4} v - The vector to divide.
	* @return {Vector4} A reference to this vector.
	*/
	divide(v) {
		this.x /= v.x;
		this.y /= v.y;
		this.z /= v.z;
		this.w /= v.w;
		return this;
	}
	/**
	* Divides this vector by the given scalar.
	*
	* @param {number} scalar - The scalar to divide.
	* @return {Vector4} A reference to this vector.
	*/
	divideScalar(scalar) {
		return this.multiplyScalar(1 / scalar);
	}
	/**
	* Sets the x, y and z components of this
	* vector to the quaternion's axis and w to the angle.
	*
	* @param {Quaternion} q - The Quaternion to set.
	* @return {Vector4} A reference to this vector.
	*/
	setAxisAngleFromQuaternion(q) {
		this.w = 2 * Math.acos(q.w);
		const s = Math.sqrt(1 - q.w * q.w);
		if (s < 1e-4) {
			this.x = 1;
			this.y = 0;
			this.z = 0;
		} else {
			this.x = q.x / s;
			this.y = q.y / s;
			this.z = q.z / s;
		}
		return this;
	}
	/**
	* Sets the x, y and z components of this
	* vector to the axis of rotation and w to the angle.
	*
	* @param {Matrix4} m - A 4x4 matrix of which the upper left 3x3 matrix is a pure rotation matrix.
	* @return {Vector4} A reference to this vector.
	*/
	setAxisAngleFromRotationMatrix(m) {
		let angle, x, y, z;
		const epsilon = .01, epsilon2 = .1, te = m.elements, m11 = te[0], m12 = te[4], m13 = te[8], m21 = te[1], m22 = te[5], m23 = te[9], m31 = te[2], m32 = te[6], m33 = te[10];
		if (Math.abs(m12 - m21) < epsilon && Math.abs(m13 - m31) < epsilon && Math.abs(m23 - m32) < epsilon) {
			if (Math.abs(m12 + m21) < epsilon2 && Math.abs(m13 + m31) < epsilon2 && Math.abs(m23 + m32) < epsilon2 && Math.abs(m11 + m22 + m33 - 3) < epsilon2) {
				this.set(1, 0, 0, 0);
				return this;
			}
			angle = Math.PI;
			const xx = (m11 + 1) / 2;
			const yy = (m22 + 1) / 2;
			const zz = (m33 + 1) / 2;
			const xy = (m12 + m21) / 4;
			const xz = (m13 + m31) / 4;
			const yz = (m23 + m32) / 4;
			if (xx > yy && xx > zz) if (xx < epsilon) {
				x = 0;
				y = .707106781;
				z = .707106781;
			} else {
				x = Math.sqrt(xx);
				y = xy / x;
				z = xz / x;
			}
			else if (yy > zz) if (yy < epsilon) {
				x = .707106781;
				y = 0;
				z = .707106781;
			} else {
				y = Math.sqrt(yy);
				x = xy / y;
				z = yz / y;
			}
			else if (zz < epsilon) {
				x = .707106781;
				y = .707106781;
				z = 0;
			} else {
				z = Math.sqrt(zz);
				x = xz / z;
				y = yz / z;
			}
			this.set(x, y, z, angle);
			return this;
		}
		let s = Math.sqrt((m32 - m23) * (m32 - m23) + (m13 - m31) * (m13 - m31) + (m21 - m12) * (m21 - m12));
		if (Math.abs(s) < .001) s = 1;
		this.x = (m32 - m23) / s;
		this.y = (m13 - m31) / s;
		this.z = (m21 - m12) / s;
		this.w = Math.acos((m11 + m22 + m33 - 1) / 2);
		return this;
	}
	/**
	* Sets the vector components to the position elements of the
	* given transformation matrix.
	*
	* @param {Matrix4} m - The 4x4 matrix.
	* @return {Vector4} A reference to this vector.
	*/
	setFromMatrixPosition(m) {
		const e = m.elements;
		this.x = e[12];
		this.y = e[13];
		this.z = e[14];
		this.w = e[15];
		return this;
	}
	/**
	* If this vector's x, y, z or w value is greater than the given vector's x, y, z or w
	* value, replace that value with the corresponding min value.
	*
	* @param {Vector4} v - The vector.
	* @return {Vector4} A reference to this vector.
	*/
	min(v) {
		this.x = Math.min(this.x, v.x);
		this.y = Math.min(this.y, v.y);
		this.z = Math.min(this.z, v.z);
		this.w = Math.min(this.w, v.w);
		return this;
	}
	/**
	* If this vector's x, y, z or w value is less than the given vector's x, y, z or w
	* value, replace that value with the corresponding max value.
	*
	* @param {Vector4} v - The vector.
	* @return {Vector4} A reference to this vector.
	*/
	max(v) {
		this.x = Math.max(this.x, v.x);
		this.y = Math.max(this.y, v.y);
		this.z = Math.max(this.z, v.z);
		this.w = Math.max(this.w, v.w);
		return this;
	}
	/**
	* If this vector's x, y, z or w value is greater than the max vector's x, y, z or w
	* value, it is replaced by the corresponding value.
	* If this vector's x, y, z or w value is less than the min vector's x, y, z or w value,
	* it is replaced by the corresponding value.
	*
	* @param {Vector4} min - The minimum x, y and z values.
	* @param {Vector4} max - The maximum x, y and z values in the desired range.
	* @return {Vector4} A reference to this vector.
	*/
	clamp(min, max) {
		this.x = clamp$1(this.x, min.x, max.x);
		this.y = clamp$1(this.y, min.y, max.y);
		this.z = clamp$1(this.z, min.z, max.z);
		this.w = clamp$1(this.w, min.w, max.w);
		return this;
	}
	/**
	* If this vector's x, y, z or w values are greater than the max value, they are
	* replaced by the max value.
	* If this vector's x, y, z or w values are less than the min value, they are
	* replaced by the min value.
	*
	* @param {number} minVal - The minimum value the components will be clamped to.
	* @param {number} maxVal - The maximum value the components will be clamped to.
	* @return {Vector4} A reference to this vector.
	*/
	clampScalar(minVal, maxVal) {
		this.x = clamp$1(this.x, minVal, maxVal);
		this.y = clamp$1(this.y, minVal, maxVal);
		this.z = clamp$1(this.z, minVal, maxVal);
		this.w = clamp$1(this.w, minVal, maxVal);
		return this;
	}
	/**
	* If this vector's length is greater than the max value, it is replaced by
	* the max value.
	* If this vector's length is less than the min value, it is replaced by the
	* min value.
	*
	* @param {number} min - The minimum value the vector length will be clamped to.
	* @param {number} max - The maximum value the vector length will be clamped to.
	* @return {Vector4} A reference to this vector.
	*/
	clampLength(min, max) {
		const length = this.length();
		return this.divideScalar(length || 1).multiplyScalar(clamp$1(length, min, max));
	}
	/**
	* The components of this vector are rounded down to the nearest integer value.
	*
	* @return {Vector4} A reference to this vector.
	*/
	floor() {
		this.x = Math.floor(this.x);
		this.y = Math.floor(this.y);
		this.z = Math.floor(this.z);
		this.w = Math.floor(this.w);
		return this;
	}
	/**
	* The components of this vector are rounded up to the nearest integer value.
	*
	* @return {Vector4} A reference to this vector.
	*/
	ceil() {
		this.x = Math.ceil(this.x);
		this.y = Math.ceil(this.y);
		this.z = Math.ceil(this.z);
		this.w = Math.ceil(this.w);
		return this;
	}
	/**
	* The components of this vector are rounded to the nearest integer value
	*
	* @return {Vector4} A reference to this vector.
	*/
	round() {
		this.x = Math.round(this.x);
		this.y = Math.round(this.y);
		this.z = Math.round(this.z);
		this.w = Math.round(this.w);
		return this;
	}
	/**
	* The components of this vector are rounded towards zero (up if negative,
	* down if positive) to an integer value.
	*
	* @return {Vector4} A reference to this vector.
	*/
	roundToZero() {
		this.x = Math.trunc(this.x);
		this.y = Math.trunc(this.y);
		this.z = Math.trunc(this.z);
		this.w = Math.trunc(this.w);
		return this;
	}
	/**
	* Inverts this vector - i.e. sets x = -x, y = -y, z = -z, w = -w.
	*
	* @return {Vector4} A reference to this vector.
	*/
	negate() {
		this.x = -this.x;
		this.y = -this.y;
		this.z = -this.z;
		this.w = -this.w;
		return this;
	}
	/**
	* Calculates the dot product of the given vector with this instance.
	*
	* @param {Vector4} v - The vector to compute the dot product with.
	* @return {number} The result of the dot product.
	*/
	dot(v) {
		return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
	}
	/**
	* Computes the square of the Euclidean length (straight-line length) from
	* (0, 0, 0, 0) to (x, y, z, w). If you are comparing the lengths of vectors, you should
	* compare the length squared instead as it is slightly more efficient to calculate.
	*
	* @return {number} The square length of this vector.
	*/
	lengthSq() {
		return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
	}
	/**
	* Computes the  Euclidean length (straight-line length) from (0, 0, 0, 0) to (x, y, z, w).
	*
	* @return {number} The length of this vector.
	*/
	length() {
		return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
	}
	/**
	* Computes the Manhattan length of this vector.
	*
	* @return {number} The length of this vector.
	*/
	manhattanLength() {
		return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.w);
	}
	/**
	* Converts this vector to a unit vector - that is, sets it equal to a vector
	* with the same direction as this one, but with a vector length of `1`.
	*
	* @return {Vector4} A reference to this vector.
	*/
	normalize() {
		return this.divideScalar(this.length() || 1);
	}
	/**
	* Sets this vector to a vector with the same direction as this one, but
	* with the specified length.
	*
	* @param {number} length - The new length of this vector.
	* @return {Vector4} A reference to this vector.
	*/
	setLength(length) {
		return this.normalize().multiplyScalar(length);
	}
	/**
	* Linearly interpolates between the given vector and this instance, where
	* alpha is the percent distance along the line - alpha = 0 will be this
	* vector, and alpha = 1 will be the given one.
	*
	* @param {Vector4} v - The vector to interpolate towards.
	* @param {number} alpha - The interpolation factor, typically in the closed interval `[0, 1]`.
	* @return {Vector4} A reference to this vector.
	*/
	lerp(v, alpha) {
		this.x += (v.x - this.x) * alpha;
		this.y += (v.y - this.y) * alpha;
		this.z += (v.z - this.z) * alpha;
		this.w += (v.w - this.w) * alpha;
		return this;
	}
	/**
	* Linearly interpolates between the given vectors, where alpha is the percent
	* distance along the line - alpha = 0 will be first vector, and alpha = 1 will
	* be the second one. The result is stored in this instance.
	*
	* @param {Vector4} v1 - The first vector.
	* @param {Vector4} v2 - The second vector.
	* @param {number} alpha - The interpolation factor, typically in the closed interval `[0, 1]`.
	* @return {Vector4} A reference to this vector.
	*/
	lerpVectors(v1, v2, alpha) {
		this.x = v1.x + (v2.x - v1.x) * alpha;
		this.y = v1.y + (v2.y - v1.y) * alpha;
		this.z = v1.z + (v2.z - v1.z) * alpha;
		this.w = v1.w + (v2.w - v1.w) * alpha;
		return this;
	}
	/**
	* Returns `true` if this vector is equal with the given one.
	*
	* @param {Vector4} v - The vector to test for equality.
	* @return {boolean} Whether this vector is equal with the given one.
	*/
	equals(v) {
		return v.x === this.x && v.y === this.y && v.z === this.z && v.w === this.w;
	}
	/**
	* Sets this vector's x value to be `array[ offset ]`, y value to be `array[ offset + 1 ]`,
	* z value to be `array[ offset + 2 ]`, w value to be `array[ offset + 3 ]`.
	*
	* @param {Array<number>} array - An array holding the vector component values.
	* @param {number} [offset=0] - The offset into the array.
	* @return {Vector4} A reference to this vector.
	*/
	fromArray(array, offset = 0) {
		this.x = array[offset];
		this.y = array[offset + 1];
		this.z = array[offset + 2];
		this.w = array[offset + 3];
		return this;
	}
	/**
	* Writes the components of this vector to the given array. If no array is provided,
	* the method returns a new instance.
	*
	* @param {Array<number>} [array=[]] - The target array holding the vector components.
	* @param {number} [offset=0] - Index of the first element in the array.
	* @return {Array<number>} The vector components.
	*/
	toArray(array = [], offset = 0) {
		array[offset] = this.x;
		array[offset + 1] = this.y;
		array[offset + 2] = this.z;
		array[offset + 3] = this.w;
		return array;
	}
	/**
	* Sets the components of this vector from the given buffer attribute.
	*
	* @param {BufferAttribute} attribute - The buffer attribute holding vector data.
	* @param {number} index - The index into the attribute.
	* @return {Vector4} A reference to this vector.
	*/
	fromBufferAttribute(attribute, index) {
		this.x = attribute.getX(index);
		this.y = attribute.getY(index);
		this.z = attribute.getZ(index);
		this.w = attribute.getW(index);
		return this;
	}
	/**
	* Sets each component of this vector to a pseudo-random value between `0` and
	* `1`, excluding `1`.
	*
	* @return {Vector4} A reference to this vector.
	*/
	random() {
		this.x = Math.random();
		this.y = Math.random();
		this.z = Math.random();
		this.w = Math.random();
		return this;
	}
	*[Symbol.iterator]() {
		yield this.x;
		yield this.y;
		yield this.z;
		yield this.w;
	}
};
/**
* Represents a 4x4 matrix.
*
* The most common use of a 4x4 matrix in 3D computer graphics is as a transformation matrix.
* For an introduction to transformation matrices as used in WebGL, check out [this tutorial](https://www.opengl-tutorial.org/beginners-tutorials/tutorial-3-matrices)
*
* This allows a 3D vector representing a point in 3D space to undergo
* transformations such as translation, rotation, shear, scale, reflection,
* orthogonal or perspective projection and so on, by being multiplied by the
* matrix. This is known as `applying` the matrix to the vector.
*
* A Note on Row-Major and Column-Major Ordering:
*
* The constructor and {@link Matrix3#set} method take arguments in
* [row-major](https://en.wikipedia.org/wiki/Row-_and_column-major_order#Column-major_order)
* order, while internally they are stored in the {@link Matrix3#elements} array in column-major order.
* This means that calling:
* ```js
* const m = new THREE.Matrix4();
* m.set( 11, 12, 13, 14,
*        21, 22, 23, 24,
*        31, 32, 33, 34,
*        41, 42, 43, 44 );
* ```
* will result in the elements array containing:
* ```js
* m.elements = [ 11, 21, 31, 41,
*                12, 22, 32, 42,
*                13, 23, 33, 43,
*                14, 24, 34, 44 ];
* ```
* and internally all calculations are performed using column-major ordering.
* However, as the actual ordering makes no difference mathematically and
* most people are used to thinking about matrices in row-major order, the
* three.js documentation shows matrices in row-major order. Just bear in
* mind that if you are reading the source code, you'll have to take the
* transpose of any matrices outlined here to make sense of the calculations.
*/
var Matrix4 = class Matrix4 {
	static {
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		Matrix4.prototype.isMatrix4 = true;
	}
	/**
	* Constructs a new 4x4 matrix. The arguments are supposed to be
	* in row-major order. If no arguments are provided, the constructor
	* initializes the matrix as an identity matrix.
	*
	* @param {number} [n11] - 1-1 matrix element.
	* @param {number} [n12] - 1-2 matrix element.
	* @param {number} [n13] - 1-3 matrix element.
	* @param {number} [n14] - 1-4 matrix element.
	* @param {number} [n21] - 2-1 matrix element.
	* @param {number} [n22] - 2-2 matrix element.
	* @param {number} [n23] - 2-3 matrix element.
	* @param {number} [n24] - 2-4 matrix element.
	* @param {number} [n31] - 3-1 matrix element.
	* @param {number} [n32] - 3-2 matrix element.
	* @param {number} [n33] - 3-3 matrix element.
	* @param {number} [n34] - 3-4 matrix element.
	* @param {number} [n41] - 4-1 matrix element.
	* @param {number} [n42] - 4-2 matrix element.
	* @param {number} [n43] - 4-3 matrix element.
	* @param {number} [n44] - 4-4 matrix element.
	*/
	constructor(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) {
		/**
		* A column-major list of matrix values.
		*
		* @type {Array<number>}
		*/
		this.elements = [
			1,
			0,
			0,
			0,
			0,
			1,
			0,
			0,
			0,
			0,
			1,
			0,
			0,
			0,
			0,
			1
		];
		if (n11 !== void 0) this.set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44);
	}
	/**
	* Sets the elements of the matrix.The arguments are supposed to be
	* in row-major order.
	*
	* @param {number} [n11] - 1-1 matrix element.
	* @param {number} [n12] - 1-2 matrix element.
	* @param {number} [n13] - 1-3 matrix element.
	* @param {number} [n14] - 1-4 matrix element.
	* @param {number} [n21] - 2-1 matrix element.
	* @param {number} [n22] - 2-2 matrix element.
	* @param {number} [n23] - 2-3 matrix element.
	* @param {number} [n24] - 2-4 matrix element.
	* @param {number} [n31] - 3-1 matrix element.
	* @param {number} [n32] - 3-2 matrix element.
	* @param {number} [n33] - 3-3 matrix element.
	* @param {number} [n34] - 3-4 matrix element.
	* @param {number} [n41] - 4-1 matrix element.
	* @param {number} [n42] - 4-2 matrix element.
	* @param {number} [n43] - 4-3 matrix element.
	* @param {number} [n44] - 4-4 matrix element.
	* @return {Matrix4} A reference to this matrix.
	*/
	set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) {
		const te = this.elements;
		te[0] = n11;
		te[4] = n12;
		te[8] = n13;
		te[12] = n14;
		te[1] = n21;
		te[5] = n22;
		te[9] = n23;
		te[13] = n24;
		te[2] = n31;
		te[6] = n32;
		te[10] = n33;
		te[14] = n34;
		te[3] = n41;
		te[7] = n42;
		te[11] = n43;
		te[15] = n44;
		return this;
	}
	/**
	* Sets this matrix to the 4x4 identity matrix.
	*
	* @return {Matrix4} A reference to this matrix.
	*/
	identity() {
		this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
		return this;
	}
	/**
	* Returns a matrix with copied values from this instance.
	*
	* @return {Matrix4} A clone of this instance.
	*/
	clone() {
		return new Matrix4().fromArray(this.elements);
	}
	/**
	* Copies the values of the given matrix to this instance.
	*
	* @param {Matrix4} m - The matrix to copy.
	* @return {Matrix4} A reference to this matrix.
	*/
	copy(m) {
		const te = this.elements;
		const me = m.elements;
		te[0] = me[0];
		te[1] = me[1];
		te[2] = me[2];
		te[3] = me[3];
		te[4] = me[4];
		te[5] = me[5];
		te[6] = me[6];
		te[7] = me[7];
		te[8] = me[8];
		te[9] = me[9];
		te[10] = me[10];
		te[11] = me[11];
		te[12] = me[12];
		te[13] = me[13];
		te[14] = me[14];
		te[15] = me[15];
		return this;
	}
	/**
	* Copies the translation component of the given matrix
	* into this matrix's translation component.
	*
	* @param {Matrix4} m - The matrix to copy the translation component.
	* @return {Matrix4} A reference to this matrix.
	*/
	copyPosition(m) {
		const te = this.elements, me = m.elements;
		te[12] = me[12];
		te[13] = me[13];
		te[14] = me[14];
		return this;
	}
	/**
	* Set the upper 3x3 elements of this matrix to the values of given 3x3 matrix.
	*
	* @param {Matrix3} m - The 3x3 matrix.
	* @return {Matrix4} A reference to this matrix.
	*/
	setFromMatrix3(m) {
		const me = m.elements;
		this.set(me[0], me[3], me[6], 0, me[1], me[4], me[7], 0, me[2], me[5], me[8], 0, 0, 0, 0, 1);
		return this;
	}
	/**
	* Extracts the basis of this matrix into the three axis vectors provided.
	*
	* @param {Vector3} xAxis - The basis's x axis.
	* @param {Vector3} yAxis - The basis's y axis.
	* @param {Vector3} zAxis - The basis's z axis.
	* @return {Matrix4} A reference to this matrix.
	*/
	extractBasis(xAxis, yAxis, zAxis) {
		if (this.determinantAffine() === 0) {
			xAxis.set(1, 0, 0);
			yAxis.set(0, 1, 0);
			zAxis.set(0, 0, 1);
			return this;
		}
		xAxis.setFromMatrixColumn(this, 0);
		yAxis.setFromMatrixColumn(this, 1);
		zAxis.setFromMatrixColumn(this, 2);
		return this;
	}
	/**
	* Sets the given basis vectors to this matrix.
	*
	* @param {Vector3} xAxis - The basis's x axis.
	* @param {Vector3} yAxis - The basis's y axis.
	* @param {Vector3} zAxis - The basis's z axis.
	* @return {Matrix4} A reference to this matrix.
	*/
	makeBasis(xAxis, yAxis, zAxis) {
		this.set(xAxis.x, yAxis.x, zAxis.x, 0, xAxis.y, yAxis.y, zAxis.y, 0, xAxis.z, yAxis.z, zAxis.z, 0, 0, 0, 0, 1);
		return this;
	}
	/**
	* Extracts the rotation component of the given matrix
	* into this matrix's rotation component.
	*
	* Note: This method does not support reflection matrices.
	*
	* @param {Matrix4} m - The matrix.
	* @return {Matrix4} A reference to this matrix.
	*/
	extractRotation(m) {
		if (m.determinantAffine() === 0) return this.identity();
		const te = this.elements;
		const me = m.elements;
		const scaleX = 1 / _v1$7.setFromMatrixColumn(m, 0).length();
		const scaleY = 1 / _v1$7.setFromMatrixColumn(m, 1).length();
		const scaleZ = 1 / _v1$7.setFromMatrixColumn(m, 2).length();
		te[0] = me[0] * scaleX;
		te[1] = me[1] * scaleX;
		te[2] = me[2] * scaleX;
		te[3] = 0;
		te[4] = me[4] * scaleY;
		te[5] = me[5] * scaleY;
		te[6] = me[6] * scaleY;
		te[7] = 0;
		te[8] = me[8] * scaleZ;
		te[9] = me[9] * scaleZ;
		te[10] = me[10] * scaleZ;
		te[11] = 0;
		te[12] = 0;
		te[13] = 0;
		te[14] = 0;
		te[15] = 1;
		return this;
	}
	/**
	* Sets the rotation component (the upper left 3x3 matrix) of this matrix to
	* the rotation specified by the given Euler angles. The rest of
	* the matrix is set to the identity. Depending on the {@link Euler#order},
	* there are six possible outcomes. See [this page](https://en.wikipedia.org/wiki/Euler_angles#Rotation_matrix)
	* for a complete list.
	*
	* @param {Euler} euler - The Euler angles.
	* @return {Matrix4} A reference to this matrix.
	*/
	makeRotationFromEuler(euler) {
		const te = this.elements;
		const x = euler.x, y = euler.y, z = euler.z;
		const a = Math.cos(x), b = Math.sin(x);
		const c = Math.cos(y), d = Math.sin(y);
		const e = Math.cos(z), f = Math.sin(z);
		if (euler.order === "XYZ") {
			const ae = a * e, af = a * f, be = b * e, bf = b * f;
			te[0] = c * e;
			te[4] = -c * f;
			te[8] = d;
			te[1] = af + be * d;
			te[5] = ae - bf * d;
			te[9] = -b * c;
			te[2] = bf - ae * d;
			te[6] = be + af * d;
			te[10] = a * c;
		} else if (euler.order === "YXZ") {
			const ce = c * e, cf = c * f, de = d * e, df = d * f;
			te[0] = ce + df * b;
			te[4] = de * b - cf;
			te[8] = a * d;
			te[1] = a * f;
			te[5] = a * e;
			te[9] = -b;
			te[2] = cf * b - de;
			te[6] = df + ce * b;
			te[10] = a * c;
		} else if (euler.order === "ZXY") {
			const ce = c * e, cf = c * f, de = d * e, df = d * f;
			te[0] = ce - df * b;
			te[4] = -a * f;
			te[8] = de + cf * b;
			te[1] = cf + de * b;
			te[5] = a * e;
			te[9] = df - ce * b;
			te[2] = -a * d;
			te[6] = b;
			te[10] = a * c;
		} else if (euler.order === "ZYX") {
			const ae = a * e, af = a * f, be = b * e, bf = b * f;
			te[0] = c * e;
			te[4] = be * d - af;
			te[8] = ae * d + bf;
			te[1] = c * f;
			te[5] = bf * d + ae;
			te[9] = af * d - be;
			te[2] = -d;
			te[6] = b * c;
			te[10] = a * c;
		} else if (euler.order === "YZX") {
			const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
			te[0] = c * e;
			te[4] = bd - ac * f;
			te[8] = bc * f + ad;
			te[1] = f;
			te[5] = a * e;
			te[9] = -b * e;
			te[2] = -d * e;
			te[6] = ad * f + bc;
			te[10] = ac - bd * f;
		} else if (euler.order === "XZY") {
			const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
			te[0] = c * e;
			te[4] = -f;
			te[8] = d * e;
			te[1] = ac * f + bd;
			te[5] = a * e;
			te[9] = ad * f - bc;
			te[2] = bc * f - ad;
			te[6] = b * e;
			te[10] = bd * f + ac;
		}
		te[3] = 0;
		te[7] = 0;
		te[11] = 0;
		te[12] = 0;
		te[13] = 0;
		te[14] = 0;
		te[15] = 1;
		return this;
	}
	/**
	* Sets the rotation component of this matrix to the rotation specified by
	* the given Quaternion as outlined [here](https://en.wikipedia.org/wiki/Rotation_matrix#Quaternion)
	* The rest of the matrix is set to the identity.
	*
	* @param {Quaternion} q - The Quaternion.
	* @return {Matrix4} A reference to this matrix.
	*/
	makeRotationFromQuaternion(q) {
		return this.compose(_zero, q, _one);
	}
	/**
	* Sets the rotation component of the transformation matrix, looking from `eye` towards
	* `target`, and oriented by the up-direction.
	*
	* @param {Vector3} eye - The eye vector.
	* @param {Vector3} target - The target vector.
	* @param {Vector3} up - The up vector.
	* @return {Matrix4} A reference to this matrix.
	*/
	lookAt(eye, target, up) {
		const te = this.elements;
		_z.subVectors(eye, target);
		if (_z.lengthSq() === 0) _z.z = 1;
		_z.normalize();
		_x.crossVectors(up, _z);
		if (_x.lengthSq() === 0) {
			if (Math.abs(up.z) === 1) _z.x += 1e-4;
			else _z.z += 1e-4;
			_z.normalize();
			_x.crossVectors(up, _z);
		}
		_x.normalize();
		_y.crossVectors(_z, _x);
		te[0] = _x.x;
		te[4] = _y.x;
		te[8] = _z.x;
		te[1] = _x.y;
		te[5] = _y.y;
		te[9] = _z.y;
		te[2] = _x.z;
		te[6] = _y.z;
		te[10] = _z.z;
		return this;
	}
	/**
	* Post-multiplies this matrix by the given 4x4 matrix.
	*
	* @param {Matrix4} m - The matrix to multiply with.
	* @return {Matrix4} A reference to this matrix.
	*/
	multiply(m) {
		return this.multiplyMatrices(this, m);
	}
	/**
	* Pre-multiplies this matrix by the given 4x4 matrix.
	*
	* @param {Matrix4} m - The matrix to multiply with.
	* @return {Matrix4} A reference to this matrix.
	*/
	premultiply(m) {
		return this.multiplyMatrices(m, this);
	}
	/**
	* Multiples the given 4x4 matrices and stores the result
	* in this matrix.
	*
	* @param {Matrix4} a - The first matrix.
	* @param {Matrix4} b - The second matrix.
	* @return {Matrix4} A reference to this matrix.
	*/
	multiplyMatrices(a, b) {
		const ae = a.elements;
		const be = b.elements;
		const te = this.elements;
		const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
		const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
		const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
		const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
		const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
		const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
		const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
		const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
		te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
		te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
		te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
		te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
		te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
		te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
		te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
		te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
		te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
		te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
		te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
		te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
		te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
		te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
		te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
		te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
		return this;
	}
	/**
	* Multiplies every component of the matrix by the given scalar.
	*
	* @param {number} s - The scalar.
	* @return {Matrix4} A reference to this matrix.
	*/
	multiplyScalar(s) {
		const te = this.elements;
		te[0] *= s;
		te[4] *= s;
		te[8] *= s;
		te[12] *= s;
		te[1] *= s;
		te[5] *= s;
		te[9] *= s;
		te[13] *= s;
		te[2] *= s;
		te[6] *= s;
		te[10] *= s;
		te[14] *= s;
		te[3] *= s;
		te[7] *= s;
		te[11] *= s;
		te[15] *= s;
		return this;
	}
	/**
	* Computes and returns the determinant of this matrix.
	*
	* Based on the method outlined [here](http://www.euclideanspace.com/maths/algebra/matrix/functions/inverse/fourD/index.html).
	*
	* @return {number} The determinant.
	*/
	determinant() {
		const te = this.elements;
		const n11 = te[0], n12 = te[4], n13 = te[8], n14 = te[12];
		const n21 = te[1], n22 = te[5], n23 = te[9], n24 = te[13];
		const n31 = te[2], n32 = te[6], n33 = te[10], n34 = te[14];
		const n41 = te[3], n42 = te[7], n43 = te[11], n44 = te[15];
		const t11 = n23 * n34 - n24 * n33;
		const t12 = n22 * n34 - n24 * n32;
		const t13 = n22 * n33 - n23 * n32;
		const t21 = n21 * n34 - n24 * n31;
		const t22 = n21 * n33 - n23 * n31;
		const t23 = n21 * n32 - n22 * n31;
		return n11 * (n42 * t11 - n43 * t12 + n44 * t13) - n12 * (n41 * t11 - n43 * t21 + n44 * t22) + n13 * (n41 * t12 - n42 * t21 + n44 * t23) - n14 * (n41 * t13 - n42 * t22 + n43 * t23);
	}
	/**
	* Computes and returns the determinant of the 4x4 matrix, but assumes the
	* matrix is affine, saving some computations.
	*
	* For affine matrices (like an object's world matrix), this value equals the
	* full 4x4 {@link Matrix4#determinant} but is cheaper to compute.
	*
	* Assumes the bottom row is [0, 0, 0, 1].
	*
	* @return {number} The determinant of the matrix.
	*/
	determinantAffine() {
		const te = this.elements;
		const n11 = te[0], n12 = te[4], n13 = te[8];
		const n21 = te[1], n22 = te[5], n23 = te[9];
		const n31 = te[2], n32 = te[6], n33 = te[10];
		return n11 * (n22 * n33 - n23 * n32) - n12 * (n21 * n33 - n23 * n31) + n13 * (n21 * n32 - n22 * n31);
	}
	/**
	* Transposes this matrix in place.
	*
	* @return {Matrix4} A reference to this matrix.
	*/
	transpose() {
		const te = this.elements;
		let tmp;
		tmp = te[1];
		te[1] = te[4];
		te[4] = tmp;
		tmp = te[2];
		te[2] = te[8];
		te[8] = tmp;
		tmp = te[6];
		te[6] = te[9];
		te[9] = tmp;
		tmp = te[3];
		te[3] = te[12];
		te[12] = tmp;
		tmp = te[7];
		te[7] = te[13];
		te[13] = tmp;
		tmp = te[11];
		te[11] = te[14];
		te[14] = tmp;
		return this;
	}
	/**
	* Sets the position component for this matrix from the given vector,
	* without affecting the rest of the matrix.
	*
	* @param {number|Vector3} x - The x component of the vector or alternatively the vector object.
	* @param {number} y - The y component of the vector.
	* @param {number} z - The z component of the vector.
	* @return {Matrix4} A reference to this matrix.
	*/
	setPosition(x, y, z) {
		const te = this.elements;
		if (x.isVector3) {
			te[12] = x.x;
			te[13] = x.y;
			te[14] = x.z;
		} else {
			te[12] = x;
			te[13] = y;
			te[14] = z;
		}
		return this;
	}
	/**
	* Inverts this matrix, using the [analytic method](https://en.wikipedia.org/wiki/Invertible_matrix#Analytic_solution).
	* You can not invert with a determinant of zero. If you attempt this, the method produces
	* a zero matrix instead.
	*
	* @return {Matrix4} A reference to this matrix.
	*/
	invert() {
		const te = this.elements, n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3], n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7], n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11], n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15], t1 = n11 * n22 - n21 * n12, t2 = n11 * n32 - n31 * n12, t3 = n11 * n42 - n41 * n12, t4 = n21 * n32 - n31 * n22, t5 = n21 * n42 - n41 * n22, t6 = n31 * n42 - n41 * n32, t7 = n13 * n24 - n23 * n14, t8 = n13 * n34 - n33 * n14, t9 = n13 * n44 - n43 * n14, t10 = n23 * n34 - n33 * n24, t11 = n23 * n44 - n43 * n24, t12 = n33 * n44 - n43 * n34;
		const det = t1 * t12 - t2 * t11 + t3 * t10 + t4 * t9 - t5 * t8 + t6 * t7;
		if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
		const detInv = 1 / det;
		te[0] = (n22 * t12 - n32 * t11 + n42 * t10) * detInv;
		te[1] = (n31 * t11 - n21 * t12 - n41 * t10) * detInv;
		te[2] = (n24 * t6 - n34 * t5 + n44 * t4) * detInv;
		te[3] = (n33 * t5 - n23 * t6 - n43 * t4) * detInv;
		te[4] = (n32 * t9 - n12 * t12 - n42 * t8) * detInv;
		te[5] = (n11 * t12 - n31 * t9 + n41 * t8) * detInv;
		te[6] = (n34 * t3 - n14 * t6 - n44 * t2) * detInv;
		te[7] = (n13 * t6 - n33 * t3 + n43 * t2) * detInv;
		te[8] = (n12 * t11 - n22 * t9 + n42 * t7) * detInv;
		te[9] = (n21 * t9 - n11 * t11 - n41 * t7) * detInv;
		te[10] = (n14 * t5 - n24 * t3 + n44 * t1) * detInv;
		te[11] = (n23 * t3 - n13 * t5 - n43 * t1) * detInv;
		te[12] = (n22 * t8 - n12 * t10 - n32 * t7) * detInv;
		te[13] = (n11 * t10 - n21 * t8 + n31 * t7) * detInv;
		te[14] = (n24 * t2 - n14 * t4 - n34 * t1) * detInv;
		te[15] = (n13 * t4 - n23 * t2 + n33 * t1) * detInv;
		return this;
	}
	/**
	* Multiplies the columns of this matrix by the given vector.
	*
	* @param {Vector3} v - The scale vector.
	* @return {Matrix4} A reference to this matrix.
	*/
	scale(v) {
		const te = this.elements;
		const x = v.x, y = v.y, z = v.z;
		te[0] *= x;
		te[4] *= y;
		te[8] *= z;
		te[1] *= x;
		te[5] *= y;
		te[9] *= z;
		te[2] *= x;
		te[6] *= y;
		te[10] *= z;
		te[3] *= x;
		te[7] *= y;
		te[11] *= z;
		return this;
	}
	/**
	* Gets the maximum scale value of the three axes.
	*
	* @return {number} The maximum scale.
	*/
	getMaxScaleOnAxis() {
		const te = this.elements;
		const scaleXSq = te[0] * te[0] + te[1] * te[1] + te[2] * te[2];
		const scaleYSq = te[4] * te[4] + te[5] * te[5] + te[6] * te[6];
		const scaleZSq = te[8] * te[8] + te[9] * te[9] + te[10] * te[10];
		return Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
	}
	/**
	* Sets this matrix as a translation transform from the given vector.
	*
	* @param {number|Vector3} x - The amount to translate in the X axis or alternatively a translation vector.
	* @param {number} y - The amount to translate in the Y axis.
	* @param {number} z - The amount to translate in the z axis.
	* @return {Matrix4} A reference to this matrix.
	*/
	makeTranslation(x, y, z) {
		if (x.isVector3) this.set(1, 0, 0, x.x, 0, 1, 0, x.y, 0, 0, 1, x.z, 0, 0, 0, 1);
		else this.set(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1);
		return this;
	}
	/**
	* Sets this matrix as a rotational transformation around the X axis by
	* the given angle.
	*
	* @param {number} theta - The rotation in radians.
	* @return {Matrix4} A reference to this matrix.
	*/
	makeRotationX(theta) {
		const c = Math.cos(theta), s = Math.sin(theta);
		this.set(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1);
		return this;
	}
	/**
	* Sets this matrix as a rotational transformation around the Y axis by
	* the given angle.
	*
	* @param {number} theta - The rotation in radians.
	* @return {Matrix4} A reference to this matrix.
	*/
	makeRotationY(theta) {
		const c = Math.cos(theta), s = Math.sin(theta);
		this.set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1);
		return this;
	}
	/**
	* Sets this matrix as a rotational transformation around the Z axis by
	* the given angle.
	*
	* @param {number} theta - The rotation in radians.
	* @return {Matrix4} A reference to this matrix.
	*/
	makeRotationZ(theta) {
		const c = Math.cos(theta), s = Math.sin(theta);
		this.set(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
		return this;
	}
	/**
	* Sets this matrix as a rotational transformation around the given axis by
	* the given angle.
	*
	* This is a somewhat controversial but mathematically sound alternative to
	* rotating via Quaternions. See the discussion [here](https://www.gamedev.net/articles/programming/math-and-physics/do-we-really-need-quaternions-r1199).
	*
	* @param {Vector3} axis - The normalized rotation axis.
	* @param {number} angle - The rotation in radians.
	* @return {Matrix4} A reference to this matrix.
	*/
	makeRotationAxis(axis, angle) {
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		const t = 1 - c;
		const x = axis.x, y = axis.y, z = axis.z;
		const tx = t * x, ty = t * y;
		this.set(tx * x + c, tx * y - s * z, tx * z + s * y, 0, tx * y + s * z, ty * y + c, ty * z - s * x, 0, tx * z - s * y, ty * z + s * x, t * z * z + c, 0, 0, 0, 0, 1);
		return this;
	}
	/**
	* Sets this matrix as a scale transformation.
	*
	* @param {number} x - The amount to scale in the X axis.
	* @param {number} y - The amount to scale in the Y axis.
	* @param {number} z - The amount to scale in the Z axis.
	* @return {Matrix4} A reference to this matrix.
	*/
	makeScale(x, y, z) {
		this.set(x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1);
		return this;
	}
	/**
	* Sets this matrix as a shear transformation.
	*
	* @param {number} xy - The amount to shear X by Y.
	* @param {number} xz - The amount to shear X by Z.
	* @param {number} yx - The amount to shear Y by X.
	* @param {number} yz - The amount to shear Y by Z.
	* @param {number} zx - The amount to shear Z by X.
	* @param {number} zy - The amount to shear Z by Y.
	* @return {Matrix4} A reference to this matrix.
	*/
	makeShear(xy, xz, yx, yz, zx, zy) {
		this.set(1, yx, zx, 0, xy, 1, zy, 0, xz, yz, 1, 0, 0, 0, 0, 1);
		return this;
	}
	/**
	* Sets this matrix to the transformation composed of the given position,
	* rotation (Quaternion) and scale.
	*
	* @param {Vector3} position - The position vector.
	* @param {Quaternion} quaternion - The rotation as a Quaternion.
	* @param {Vector3} scale - The scale vector.
	* @return {Matrix4} A reference to this matrix.
	*/
	compose(position, quaternion, scale) {
		const te = this.elements;
		const x = quaternion._x, y = quaternion._y, z = quaternion._z, w = quaternion._w;
		const x2 = x + x, y2 = y + y, z2 = z + z;
		const xx = x * x2, xy = x * y2, xz = x * z2;
		const yy = y * y2, yz = y * z2, zz = z * z2;
		const wx = w * x2, wy = w * y2, wz = w * z2;
		const sx = scale.x, sy = scale.y, sz = scale.z;
		te[0] = (1 - (yy + zz)) * sx;
		te[1] = (xy + wz) * sx;
		te[2] = (xz - wy) * sx;
		te[3] = 0;
		te[4] = (xy - wz) * sy;
		te[5] = (1 - (xx + zz)) * sy;
		te[6] = (yz + wx) * sy;
		te[7] = 0;
		te[8] = (xz + wy) * sz;
		te[9] = (yz - wx) * sz;
		te[10] = (1 - (xx + yy)) * sz;
		te[11] = 0;
		te[12] = position.x;
		te[13] = position.y;
		te[14] = position.z;
		te[15] = 1;
		return this;
	}
	/**
	* Decomposes this matrix into its position, rotation and scale components
	* and provides the result in the given objects.
	*
	* Note: Not all matrices are decomposable in this way. For example, if an
	* object has a non-uniformly scaled parent, then the object's world matrix
	* may not be decomposable, and this method may not be appropriate.
	*
	* @param {Vector3} position - The position vector.
	* @param {Quaternion} quaternion - The rotation as a Quaternion.
	* @param {Vector3} scale - The scale vector.
	* @return {Matrix4} A reference to this matrix.
	*/
	decompose(position, quaternion, scale) {
		const te = this.elements;
		position.x = te[12];
		position.y = te[13];
		position.z = te[14];
		const det = this.determinantAffine();
		if (det === 0) {
			scale.set(1, 1, 1);
			quaternion.identity();
			return this;
		}
		let sx = _v1$7.set(te[0], te[1], te[2]).length();
		const sy = _v1$7.set(te[4], te[5], te[6]).length();
		const sz = _v1$7.set(te[8], te[9], te[10]).length();
		if (det < 0) sx = -sx;
		_m1$2.copy(this);
		const invSX = 1 / sx;
		const invSY = 1 / sy;
		const invSZ = 1 / sz;
		_m1$2.elements[0] *= invSX;
		_m1$2.elements[1] *= invSX;
		_m1$2.elements[2] *= invSX;
		_m1$2.elements[4] *= invSY;
		_m1$2.elements[5] *= invSY;
		_m1$2.elements[6] *= invSY;
		_m1$2.elements[8] *= invSZ;
		_m1$2.elements[9] *= invSZ;
		_m1$2.elements[10] *= invSZ;
		quaternion.setFromRotationMatrix(_m1$2);
		scale.x = sx;
		scale.y = sy;
		scale.z = sz;
		return this;
	}
	/**
	* Creates a perspective projection matrix. This is used internally by
	* {@link PerspectiveCamera#updateProjectionMatrix}.
	
	* @param {number} left - Left boundary of the viewing frustum at the near plane.
	* @param {number} right - Right boundary of the viewing frustum at the near plane.
	* @param {number} top - Top boundary of the viewing frustum at the near plane.
	* @param {number} bottom - Bottom boundary of the viewing frustum at the near plane.
	* @param {number} near - The distance from the camera to the near plane.
	* @param {number} far - The distance from the camera to the far plane.
	* @param {(WebGLCoordinateSystem|WebGPUCoordinateSystem)} [coordinateSystem=WebGLCoordinateSystem] - The coordinate system.
	* @param {boolean} [reversedDepth=false] - Whether to use a reversed depth.
	* @return {Matrix4} A reference to this matrix.
	*/
	makePerspective(left, right, top, bottom, near, far, coordinateSystem = WebGLCoordinateSystem, reversedDepth = false) {
		const te = this.elements;
		const x = 2 * near / (right - left);
		const y = 2 * near / (top - bottom);
		const a = (right + left) / (right - left);
		const b = (top + bottom) / (top - bottom);
		let c, d;
		if (reversedDepth) {
			c = near / (far - near);
			d = far * near / (far - near);
		} else if (coordinateSystem === 2e3) {
			c = -(far + near) / (far - near);
			d = -2 * far * near / (far - near);
		} else if (coordinateSystem === 2001) {
			c = -far / (far - near);
			d = -far * near / (far - near);
		} else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: " + coordinateSystem);
		te[0] = x;
		te[4] = 0;
		te[8] = a;
		te[12] = 0;
		te[1] = 0;
		te[5] = y;
		te[9] = b;
		te[13] = 0;
		te[2] = 0;
		te[6] = 0;
		te[10] = c;
		te[14] = d;
		te[3] = 0;
		te[7] = 0;
		te[11] = -1;
		te[15] = 0;
		return this;
	}
	/**
	* Creates a orthographic projection matrix. This is used internally by
	* {@link OrthographicCamera#updateProjectionMatrix}.
	
	* @param {number} left - Left boundary of the viewing frustum at the near plane.
	* @param {number} right - Right boundary of the viewing frustum at the near plane.
	* @param {number} top - Top boundary of the viewing frustum at the near plane.
	* @param {number} bottom - Bottom boundary of the viewing frustum at the near plane.
	* @param {number} near - The distance from the camera to the near plane.
	* @param {number} far - The distance from the camera to the far plane.
	* @param {(WebGLCoordinateSystem|WebGPUCoordinateSystem)} [coordinateSystem=WebGLCoordinateSystem] - The coordinate system.
	* @param {boolean} [reversedDepth=false] - Whether to use a reversed depth.
	* @return {Matrix4} A reference to this matrix.
	*/
	makeOrthographic(left, right, top, bottom, near, far, coordinateSystem = WebGLCoordinateSystem, reversedDepth = false) {
		const te = this.elements;
		const x = 2 / (right - left);
		const y = 2 / (top - bottom);
		const a = -(right + left) / (right - left);
		const b = -(top + bottom) / (top - bottom);
		let c, d;
		if (reversedDepth) {
			c = 1 / (far - near);
			d = far / (far - near);
		} else if (coordinateSystem === 2e3) {
			c = -2 / (far - near);
			d = -(far + near) / (far - near);
		} else if (coordinateSystem === 2001) {
			c = -1 / (far - near);
			d = -near / (far - near);
		} else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: " + coordinateSystem);
		te[0] = x;
		te[4] = 0;
		te[8] = 0;
		te[12] = a;
		te[1] = 0;
		te[5] = y;
		te[9] = 0;
		te[13] = b;
		te[2] = 0;
		te[6] = 0;
		te[10] = c;
		te[14] = d;
		te[3] = 0;
		te[7] = 0;
		te[11] = 0;
		te[15] = 1;
		return this;
	}
	/**
	* Returns `true` if this matrix is equal with the given one.
	*
	* @param {Matrix4} matrix - The matrix to test for equality.
	* @return {boolean} Whether this matrix is equal with the given one.
	*/
	equals(matrix) {
		const te = this.elements;
		const me = matrix.elements;
		for (let i = 0; i < 16; i++) if (te[i] !== me[i]) return false;
		return true;
	}
	/**
	* Sets the elements of the matrix from the given array.
	*
	* @param {Array<number>} array - The matrix elements in column-major order.
	* @param {number} [offset=0] - Index of the first element in the array.
	* @return {Matrix4} A reference to this matrix.
	*/
	fromArray(array, offset = 0) {
		for (let i = 0; i < 16; i++) this.elements[i] = array[i + offset];
		return this;
	}
	/**
	* Writes the elements of this matrix to the given array. If no array is provided,
	* the method returns a new instance.
	*
	* @param {Array<number>} [array=[]] - The target array holding the matrix elements in column-major order.
	* @param {number} [offset=0] - Index of the first element in the array.
	* @return {Array<number>} The matrix elements in column-major order.
	*/
	toArray(array = [], offset = 0) {
		const te = this.elements;
		array[offset] = te[0];
		array[offset + 1] = te[1];
		array[offset + 2] = te[2];
		array[offset + 3] = te[3];
		array[offset + 4] = te[4];
		array[offset + 5] = te[5];
		array[offset + 6] = te[6];
		array[offset + 7] = te[7];
		array[offset + 8] = te[8];
		array[offset + 9] = te[9];
		array[offset + 10] = te[10];
		array[offset + 11] = te[11];
		array[offset + 12] = te[12];
		array[offset + 13] = te[13];
		array[offset + 14] = te[14];
		array[offset + 15] = te[15];
		return array;
	}
};
const _v1$7 = /*@__PURE__*/ new Vector3();
const _m1$2 = /*@__PURE__*/ new Matrix4();
const _zero = /*@__PURE__*/ new Vector3(0, 0, 0);
const _one = /*@__PURE__*/ new Vector3(1, 1, 1);
const _x = /*@__PURE__*/ new Vector3();
const _y = /*@__PURE__*/ new Vector3();
const _z = /*@__PURE__*/ new Vector3();
const _matrix$2 = /*@__PURE__*/ new Matrix4();
const _quaternion$4 = /*@__PURE__*/ new Quaternion();
/**
* A class representing Euler angles.
*
* Euler angles describe a rotational transformation by rotating an object on
* its various axes in specified amounts per axis, and a specified axis
* order.
*
* Iterating through an instance will yield its components (x, y, z,
* order) in the corresponding order.
*
* ```js
* const a = new THREE.Euler( 0, 1, 1.57, 'XYZ' );
* const b = new THREE.Vector3( 1, 0, 1 );
* b.applyEuler(a);
* ```
*/
var Euler = class Euler {
	/**
	* Constructs a new euler instance.
	*
	* @param {number} [x=0] - The angle of the x axis in radians.
	* @param {number} [y=0] - The angle of the y axis in radians.
	* @param {number} [z=0] - The angle of the z axis in radians.
	* @param {string} [order=Euler.DEFAULT_ORDER] - A string representing the order that the rotations are applied.
	*/
	constructor(x = 0, y = 0, z = 0, order = Euler.DEFAULT_ORDER) {
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isEuler = true;
		this._x = x;
		this._y = y;
		this._z = z;
		this._order = order;
	}
	/**
	* The angle of the x axis in radians.
	*
	* @type {number}
	* @default 0
	*/
	get x() {
		return this._x;
	}
	set x(value) {
		this._x = value;
		this._onChangeCallback();
	}
	/**
	* The angle of the y axis in radians.
	*
	* @type {number}
	* @default 0
	*/
	get y() {
		return this._y;
	}
	set y(value) {
		this._y = value;
		this._onChangeCallback();
	}
	/**
	* The angle of the z axis in radians.
	*
	* @type {number}
	* @default 0
	*/
	get z() {
		return this._z;
	}
	set z(value) {
		this._z = value;
		this._onChangeCallback();
	}
	/**
	* A string representing the order that the rotations are applied.
	*
	* @type {string}
	* @default 'XYZ'
	*/
	get order() {
		return this._order;
	}
	set order(value) {
		this._order = value;
		this._onChangeCallback();
	}
	/**
	* Sets the Euler components.
	*
	* @param {number} x - The angle of the x axis in radians.
	* @param {number} y - The angle of the y axis in radians.
	* @param {number} z - The angle of the z axis in radians.
	* @param {string} [order] - A string representing the order that the rotations are applied.
	* @return {Euler} A reference to this Euler instance.
	*/
	set(x, y, z, order = this._order) {
		this._x = x;
		this._y = y;
		this._z = z;
		this._order = order;
		this._onChangeCallback();
		return this;
	}
	/**
	* Returns a new Euler instance with copied values from this instance.
	*
	* @return {Euler} A clone of this instance.
	*/
	clone() {
		return new this.constructor(this._x, this._y, this._z, this._order);
	}
	/**
	* Copies the values of the given Euler instance to this instance.
	*
	* @param {Euler} euler - The Euler instance to copy.
	* @return {Euler} A reference to this Euler instance.
	*/
	copy(euler) {
		this._x = euler._x;
		this._y = euler._y;
		this._z = euler._z;
		this._order = euler._order;
		this._onChangeCallback();
		return this;
	}
	/**
	* Sets the angles of this Euler instance from a pure rotation matrix.
	*
	* @param {Matrix4} m - A 4x4 matrix of which the upper 3x3 of matrix is a pure rotation matrix (i.e. unscaled).
	* @param {string} [order] - A string representing the order that the rotations are applied.
	* @param {boolean} [update=true] - Whether the internal `onChange` callback should be executed or not.
	* @return {Euler} A reference to this Euler instance.
	*/
	setFromRotationMatrix(m, order = this._order, update = true) {
		const te = m.elements;
		const m11 = te[0], m12 = te[4], m13 = te[8];
		const m21 = te[1], m22 = te[5], m23 = te[9];
		const m31 = te[2], m32 = te[6], m33 = te[10];
		switch (order) {
			case "XYZ":
				this._y = Math.asin(clamp$1(m13, -1, 1));
				if (Math.abs(m13) < .9999999) {
					this._x = Math.atan2(-m23, m33);
					this._z = Math.atan2(-m12, m11);
				} else {
					this._x = Math.atan2(m32, m22);
					this._z = 0;
				}
				break;
			case "YXZ":
				this._x = Math.asin(-clamp$1(m23, -1, 1));
				if (Math.abs(m23) < .9999999) {
					this._y = Math.atan2(m13, m33);
					this._z = Math.atan2(m21, m22);
				} else {
					this._y = Math.atan2(-m31, m11);
					this._z = 0;
				}
				break;
			case "ZXY":
				this._x = Math.asin(clamp$1(m32, -1, 1));
				if (Math.abs(m32) < .9999999) {
					this._y = Math.atan2(-m31, m33);
					this._z = Math.atan2(-m12, m22);
				} else {
					this._y = 0;
					this._z = Math.atan2(m21, m11);
				}
				break;
			case "ZYX":
				this._y = Math.asin(-clamp$1(m31, -1, 1));
				if (Math.abs(m31) < .9999999) {
					this._x = Math.atan2(m32, m33);
					this._z = Math.atan2(m21, m11);
				} else {
					this._x = 0;
					this._z = Math.atan2(-m12, m22);
				}
				break;
			case "YZX":
				this._z = Math.asin(clamp$1(m21, -1, 1));
				if (Math.abs(m21) < .9999999) {
					this._x = Math.atan2(-m23, m22);
					this._y = Math.atan2(-m31, m11);
				} else {
					this._x = 0;
					this._y = Math.atan2(m13, m33);
				}
				break;
			case "XZY":
				this._z = Math.asin(-clamp$1(m12, -1, 1));
				if (Math.abs(m12) < .9999999) {
					this._x = Math.atan2(m32, m22);
					this._y = Math.atan2(m13, m11);
				} else {
					this._x = Math.atan2(-m23, m33);
					this._y = 0;
				}
				break;
			default: warn("Euler: .setFromRotationMatrix() encountered an unknown order: " + order);
		}
		this._order = order;
		if (update === true) this._onChangeCallback();
		return this;
	}
	/**
	* Sets the angles of this Euler instance from a normalized quaternion.
	*
	* @param {Quaternion} q - A normalized Quaternion.
	* @param {string} [order] - A string representing the order that the rotations are applied.
	* @param {boolean} [update=true] - Whether the internal `onChange` callback should be executed or not.
	* @return {Euler} A reference to this Euler instance.
	*/
	setFromQuaternion(q, order, update) {
		_matrix$2.makeRotationFromQuaternion(q);
		return this.setFromRotationMatrix(_matrix$2, order, update);
	}
	/**
	* Sets the angles of this Euler instance from the given vector.
	*
	* @param {Vector3} v - The vector.
	* @param {string} [order] - A string representing the order that the rotations are applied.
	* @return {Euler} A reference to this Euler instance.
	*/
	setFromVector3(v, order = this._order) {
		return this.set(v.x, v.y, v.z, order);
	}
	/**
	* Resets the euler angle with a new order by creating a quaternion from this
	* euler angle and then setting this euler angle with the quaternion and the
	* new order.
	*
	* Warning: This discards revolution information.
	*
	* @param {string} [newOrder] - A string representing the new order that the rotations are applied.
	* @return {Euler} A reference to this Euler instance.
	*/
	reorder(newOrder) {
		_quaternion$4.setFromEuler(this);
		return this.setFromQuaternion(_quaternion$4, newOrder);
	}
	/**
	* Returns `true` if this Euler instance is equal with the given one.
	*
	* @param {Euler} euler - The Euler instance to test for equality.
	* @return {boolean} Whether this Euler instance is equal with the given one.
	*/
	equals(euler) {
		return euler._x === this._x && euler._y === this._y && euler._z === this._z && euler._order === this._order;
	}
	/**
	* Sets this Euler instance's components to values from the given array. The first three
	* entries of the array are assign to the x,y and z components. An optional fourth entry
	* defines the Euler order.
	*
	* @param {Array<number,number,number,?string>} array - An array holding the Euler component values.
	* @return {Euler} A reference to this Euler instance.
	*/
	fromArray(array) {
		this._x = array[0];
		this._y = array[1];
		this._z = array[2];
		if (array[3] !== void 0) this._order = array[3];
		this._onChangeCallback();
		return this;
	}
	/**
	* Writes the components of this Euler instance to the given array. If no array is provided,
	* the method returns a new instance.
	*
	* @param {Array<number,number,number,string>} [array=[]] - The target array holding the Euler components.
	* @param {number} [offset=0] - Index of the first element in the array.
	* @return {Array<number,number,number,string>} The Euler components.
	*/
	toArray(array = [], offset = 0) {
		array[offset] = this._x;
		array[offset + 1] = this._y;
		array[offset + 2] = this._z;
		array[offset + 3] = this._order;
		return array;
	}
	_onChange(callback) {
		this._onChangeCallback = callback;
		return this;
	}
	_onChangeCallback() {}
	*[Symbol.iterator]() {
		yield this._x;
		yield this._y;
		yield this._z;
		yield this._order;
	}
};
/**
* The default Euler angle order.
*
* @static
* @type {string}
* @default 'XYZ'
*/
Euler.DEFAULT_ORDER = "XYZ";
/**
* A layers object assigns an 3D object to 1 or more of 32
* layers numbered `0` to `31` - internally the layers are stored as a
* bit mask], and by default all 3D objects are a member of layer `0`.
*
* This can be used to control visibility - an object must share a layer with
* a camera to be visible when that camera's view is
* rendered.
*
* All classes that inherit from {@link Object3D} have an `layers` property which
* is an instance of this class.
*/
var Layers = class {
	/**
	* Constructs a new layers instance, with membership
	* initially set to layer `0`.
	*/
	constructor() {
		/**
		* A bit mask storing which of the 32 layers this layers object is currently
		* a member of.
		*
		* @type {number}
		*/
		this.mask = 1;
	}
	/**
	* Sets membership to the given layer, and remove membership all other layers.
	*
	* @param {number} layer - The layer to set.
	*/
	set(layer) {
		this.mask = (1 << layer | 0) >>> 0;
	}
	/**
	* Adds membership of the given layer.
	*
	* @param {number} layer - The layer to enable.
	*/
	enable(layer) {
		this.mask |= 1 << layer | 0;
	}
	/**
	* Adds membership to all layers.
	*/
	enableAll() {
		this.mask = -1;
	}
	/**
	* Toggles the membership of the given layer.
	*
	* @param {number} layer - The layer to toggle.
	*/
	toggle(layer) {
		this.mask ^= 1 << layer | 0;
	}
	/**
	* Removes membership of the given layer.
	*
	* @param {number} layer - The layer to enable.
	*/
	disable(layer) {
		this.mask &= ~(1 << layer | 0);
	}
	/**
	* Removes the membership from all layers.
	*/
	disableAll() {
		this.mask = 0;
	}
	/**
	* Returns `true` if this and the given layers object have at least one
	* layer in common.
	*
	* @param {Layers} layers - The layers to test.
	* @return {boolean } Whether this and the given layers object have at least one layer in common or not.
	*/
	test(layers) {
		return (this.mask & layers.mask) !== 0;
	}
	/**
	* Returns `true` if the given layer is enabled.
	*
	* @param {number} layer - The layer to test.
	* @return {boolean } Whether the given layer is enabled or not.
	*/
	isEnabled(layer) {
		return (this.mask & (1 << layer | 0)) !== 0;
	}
};
let _object3DId = 0;
const _v1$6 = /*@__PURE__*/ new Vector3();
const _q1$1 = /*@__PURE__*/ new Quaternion();
const _m1$1 = /*@__PURE__*/ new Matrix4();
const _target = /*@__PURE__*/ new Vector3();
const _position$4 = /*@__PURE__*/ new Vector3();
const _scale$3 = /*@__PURE__*/ new Vector3();
const _quaternion$3 = /*@__PURE__*/ new Quaternion();
const _xAxis = /*@__PURE__*/ new Vector3(1, 0, 0);
const _yAxis = /*@__PURE__*/ new Vector3(0, 1, 0);
const _zAxis = /*@__PURE__*/ new Vector3(0, 0, 1);
/**
* Fires when the object has been added to its parent object.
*
* @event Object3D#added
* @type {Object}
*/
const _addedEvent = { type: "added" };
/**
* Fires when the object has been removed from its parent object.
*
* @event Object3D#removed
* @type {Object}
*/
const _removedEvent = { type: "removed" };
/**
* Fires when a new child object has been added.
*
* @event Object3D#childadded
* @type {Object}
*/
const _childaddedEvent = {
	type: "childadded",
	child: null
};
/**
* Fires when a child object has been removed.
*
* @event Object3D#childremoved
* @type {Object}
*/
const _childremovedEvent = {
	type: "childremoved",
	child: null
};
/**
* This is the base class for most objects in three.js and provides a set of
* properties and methods for manipulating objects in 3D space.
*
* @augments EventDispatcher
*/
var Object3D = class Object3D extends EventDispatcher {
	/**
	* Constructs a new 3D object.
	*/
	constructor() {
		super();
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isObject3D = true;
		/**
		* The ID of the 3D object.
		*
		* @name Object3D#id
		* @type {number}
		* @readonly
		*/
		Object.defineProperty(this, "id", { value: _object3DId++ });
		/**
		* The UUID of the 3D object.
		*
		* @type {string}
		* @readonly
		*/
		this.uuid = generateUUID();
		/**
		* The name of the 3D object.
		*
		* @type {string}
		*/
		this.name = "";
		/**
		* The type property is used for detecting the object type
		* in context of serialization/deserialization.
		*
		* @type {string}
		* @readonly
		*/
		this.type = "Object3D";
		/**
		* A reference to the parent object.
		*
		* @type {?Object3D}
		* @default null
		*/
		this.parent = null;
		/**
		* An array holding the child 3D objects of this instance.
		*
		* @type {Array<Object3D>}
		*/
		this.children = [];
		/**
		* Defines the `up` direction of the 3D object which influences
		* the orientation via methods like {@link Object3D#lookAt}.
		*
		* The default values for all 3D objects is defined by `Object3D.DEFAULT_UP`.
		*
		* @type {Vector3}
		*/
		this.up = Object3D.DEFAULT_UP.clone();
		const position = new Vector3();
		const rotation = new Euler();
		const quaternion = new Quaternion();
		const scale = new Vector3(1, 1, 1);
		function onRotationChange() {
			quaternion.setFromEuler(rotation, false);
		}
		function onQuaternionChange() {
			rotation.setFromQuaternion(quaternion, void 0, false);
		}
		rotation._onChange(onRotationChange);
		quaternion._onChange(onQuaternionChange);
		Object.defineProperties(this, {
			/**
			* Represents the object's local position.
			*
			* @name Object3D#position
			* @type {Vector3}
			* @default (0,0,0)
			*/
			position: {
				configurable: true,
				enumerable: true,
				value: position
			},
			/**
			* Represents the object's local rotation as Euler angles, in radians.
			*
			* @name Object3D#rotation
			* @type {Euler}
			* @default (0,0,0)
			*/
			rotation: {
				configurable: true,
				enumerable: true,
				value: rotation
			},
			/**
			* Represents the object's local rotation as Quaternions.
			*
			* @name Object3D#quaternion
			* @type {Quaternion}
			*/
			quaternion: {
				configurable: true,
				enumerable: true,
				value: quaternion
			},
			/**
			* Represents the object's local scale.
			*
			* @name Object3D#scale
			* @type {Vector3}
			* @default (1,1,1)
			*/
			scale: {
				configurable: true,
				enumerable: true,
				value: scale
			},
			/**
			* Represents the object's model-view matrix.
			*
			* @name Object3D#modelViewMatrix
			* @type {Matrix4}
			*/
			modelViewMatrix: { value: new Matrix4() },
			/**
			* Represents the object's normal matrix.
			*
			* @name Object3D#normalMatrix
			* @type {Matrix3}
			*/
			normalMatrix: { value: new Matrix3() }
		});
		/**
		* Represents the object's transformation matrix in local space.
		*
		* @type {Matrix4}
		*/
		this.matrix = new Matrix4();
		/**
		* Represents the object's transformation matrix in world space.
		* If the 3D object has no parent, then it's identical to the local transformation matrix
		*
		* @type {Matrix4}
		*/
		this.matrixWorld = new Matrix4();
		/**
		* When set to `true`, the engine automatically computes the local matrix from position,
		* rotation and scale every frame. If set to `false`, the app is responsible for recomputing
		* the local matrix by calling `updateMatrix()`.
		*
		* The default values for all 3D objects is defined by `Object3D.DEFAULT_MATRIX_AUTO_UPDATE`.
		*
		* @type {boolean}
		* @default true
		*/
		this.matrixAutoUpdate = Object3D.DEFAULT_MATRIX_AUTO_UPDATE;
		/**
		* When set to `true`, the engine automatically computes the world matrix from the current local
		* matrix and the object's transformation hierarchy. If set to `false`, the app is responsible for
		* recomputing the world matrix by directly updating the `matrixWorld` property.
		*
		* The default values for all 3D objects is defined by `Object3D.DEFAULT_MATRIX_WORLD_AUTO_UPDATE`.
		*
		* @type {boolean}
		* @default true
		*/
		this.matrixWorldAutoUpdate = Object3D.DEFAULT_MATRIX_WORLD_AUTO_UPDATE;
		/**
		* When set to `true`, it calculates the world matrix in that frame and resets this property
		* to `false`.
		*
		* @type {boolean}
		* @default false
		*/
		this.matrixWorldNeedsUpdate = false;
		/**
		* The layer membership of the 3D object. The 3D object is only visible if it has
		* at least one layer in common with the camera in use. This property can also be
		* used to filter out unwanted objects in ray-intersection tests when using {@link Raycaster}.
		*
		* @type {Layers}
		*/
		this.layers = new Layers();
		/**
		* When set to `true`, the 3D object gets rendered.
		*
		* @type {boolean}
		* @default true
		*/
		this.visible = true;
		/**
		* When set to `true`, the 3D object gets rendered into shadow maps.
		*
		* @type {boolean}
		* @default false
		*/
		this.castShadow = false;
		/**
		* When set to `true`, the 3D object is affected by shadows in the scene.
		*
		* @type {boolean}
		* @default false
		*/
		this.receiveShadow = false;
		/**
		* When set to `true`, the 3D object is honored by view frustum culling.
		*
		* @type {boolean}
		* @default true
		*/
		this.frustumCulled = true;
		/**
		* This value allows the default rendering order of scene graph objects to be
		* overridden although opaque and transparent objects remain sorted independently.
		* When this property is set for an instance of {@link Group},all descendants
		* objects will be sorted and rendered together. Sorting is from lowest to highest
		* render order.
		*
		* @type {number}
		* @default 0
		*/
		this.renderOrder = 0;
		/**
		* An array holding the animation clips of the 3D object.
		*
		* @type {Array<AnimationClip>}
		*/
		this.animations = [];
		/**
		* Custom depth material to be used when rendering to the depth map. Can only be used
		* in context of meshes. When shadow-casting with a {@link DirectionalLight} or {@link SpotLight},
		* if you are modifying vertex positions in the vertex shader you must specify a custom depth
		* material for proper shadows.
		*
		* Only relevant in context of {@link WebGLRenderer}.
		*
		* @type {(Material|undefined)}
		* @default undefined
		*/
		this.customDepthMaterial = void 0;
		/**
		* Same as {@link Object3D#customDepthMaterial}, but used with {@link PointLight}.
		*
		* Only relevant in context of {@link WebGLRenderer}.
		*
		* @type {(Material|undefined)}
		* @default undefined
		*/
		this.customDistanceMaterial = void 0;
		/**
		* Whether the 3D object is supposed to be static or not. If set to `true`, it means
		* the 3D object is not going to be changed after the initial renderer. This includes
		* geometry and material settings. A static 3D object can be processed by the renderer
		* slightly faster since certain state checks can be bypassed.
		*
		* Only relevant in context of {@link WebGPURenderer}.
		*
		* @type {boolean}
		* @default false
		*/
		this.static = false;
		/**
		* An object that can be used to store custom data about the 3D object. It
		* should not hold references to functions as these will not be cloned.
		*
		* @type {Object}
		*/
		this.userData = {};
		/**
		* The pivot point for rotation and scale transformations.
		* When set, rotation and scale are applied around this point
		* instead of the object's origin.
		*
		* @type {?Vector3}
		* @default null
		*/
		this.pivot = null;
	}
	/**
	* A callback that is executed immediately before a 3D object is rendered to a shadow map.
	*
	* @param {Renderer|WebGLRenderer} renderer - The renderer.
	* @param {Object3D} object - The 3D object.
	* @param {Camera} camera - The camera that is used to render the scene.
	* @param {Camera} shadowCamera - The shadow camera.
	* @param {BufferGeometry} geometry - The 3D object's geometry.
	* @param {Material} depthMaterial - The depth material.
	* @param {Object} group - The geometry group data.
	*/
	onBeforeShadow() {}
	/**
	* A callback that is executed immediately after a 3D object is rendered to a shadow map.
	*
	* @param {Renderer|WebGLRenderer} renderer - The renderer.
	* @param {Object3D} object - The 3D object.
	* @param {Camera} camera - The camera that is used to render the scene.
	* @param {Camera} shadowCamera - The shadow camera.
	* @param {BufferGeometry} geometry - The 3D object's geometry.
	* @param {Material} depthMaterial - The depth material.
	* @param {Object} group - The geometry group data.
	*/
	onAfterShadow() {}
	/**
	* A callback that is executed immediately before a 3D object is rendered.
	*
	* @param {Renderer|WebGLRenderer} renderer - The renderer.
	* @param {Object3D} object - The 3D object.
	* @param {Camera} camera - The camera that is used to render the scene.
	* @param {BufferGeometry} geometry - The 3D object's geometry.
	* @param {Material} material - The 3D object's material.
	* @param {Object} group - The geometry group data.
	*/
	onBeforeRender() {}
	/**
	* A callback that is executed immediately after a 3D object is rendered.
	*
	* @param {Renderer|WebGLRenderer} renderer - The renderer.
	* @param {Object3D} object - The 3D object.
	* @param {Camera} camera - The camera that is used to render the scene.
	* @param {BufferGeometry} geometry - The 3D object's geometry.
	* @param {Material} material - The 3D object's material.
	* @param {Object} group - The geometry group data.
	*/
	onAfterRender() {}
	/**
	* Applies the given transformation matrix to the object and updates the object's position,
	* rotation and scale.
	*
	* @param {Matrix4} matrix - The transformation matrix.
	*/
	applyMatrix4(matrix) {
		if (this.matrixAutoUpdate) this.updateMatrix();
		this.matrix.premultiply(matrix);
		this.matrix.decompose(this.position, this.quaternion, this.scale);
	}
	/**
	* Applies a rotation represented by given the quaternion to the 3D object.
	*
	* @param {Quaternion} q - The quaternion.
	* @return {Object3D} A reference to this instance.
	*/
	applyQuaternion(q) {
		this.quaternion.premultiply(q);
		return this;
	}
	/**
	* Sets the given rotation represented as an axis/angle couple to the 3D object.
	*
	* @param {Vector3} axis - The (normalized) axis vector.
	* @param {number} angle - The angle in radians.
	*/
	setRotationFromAxisAngle(axis, angle) {
		this.quaternion.setFromAxisAngle(axis, angle);
	}
	/**
	* Sets the given rotation represented as Euler angles to the 3D object.
	*
	* @param {Euler} euler - The Euler angles.
	*/
	setRotationFromEuler(euler) {
		this.quaternion.setFromEuler(euler, true);
	}
	/**
	* Sets the given rotation represented as rotation matrix to the 3D object.
	*
	* @param {Matrix4} m - Although a 4x4 matrix is expected, the upper 3x3 portion must be
	* a pure rotation matrix (i.e, unscaled).
	*/
	setRotationFromMatrix(m) {
		this.quaternion.setFromRotationMatrix(m);
	}
	/**
	* Sets the given rotation represented as a Quaternion to the 3D object.
	*
	* @param {Quaternion} q - The Quaternion
	*/
	setRotationFromQuaternion(q) {
		this.quaternion.copy(q);
	}
	/**
	* Rotates the 3D object along an axis in local space.
	*
	* @param {Vector3} axis - The (normalized) axis vector.
	* @param {number} angle - The angle in radians.
	* @return {Object3D} A reference to this instance.
	*/
	rotateOnAxis(axis, angle) {
		_q1$1.setFromAxisAngle(axis, angle);
		this.quaternion.multiply(_q1$1);
		return this;
	}
	/**
	* Rotates the 3D object along an axis in world space.
	*
	* @param {Vector3} axis - The (normalized) axis vector.
	* @param {number} angle - The angle in radians.
	* @return {Object3D} A reference to this instance.
	*/
	rotateOnWorldAxis(axis, angle) {
		_q1$1.setFromAxisAngle(axis, angle);
		this.quaternion.premultiply(_q1$1);
		return this;
	}
	/**
	* Rotates the 3D object around its X axis in local space.
	*
	* @param {number} angle - The angle in radians.
	* @return {Object3D} A reference to this instance.
	*/
	rotateX(angle) {
		return this.rotateOnAxis(_xAxis, angle);
	}
	/**
	* Rotates the 3D object around its Y axis in local space.
	*
	* @param {number} angle - The angle in radians.
	* @return {Object3D} A reference to this instance.
	*/
	rotateY(angle) {
		return this.rotateOnAxis(_yAxis, angle);
	}
	/**
	* Rotates the 3D object around its Z axis in local space.
	*
	* @param {number} angle - The angle in radians.
	* @return {Object3D} A reference to this instance.
	*/
	rotateZ(angle) {
		return this.rotateOnAxis(_zAxis, angle);
	}
	/**
	* Translate the 3D object by a distance along the given axis in local space.
	*
	* @param {Vector3} axis - The (normalized) axis vector.
	* @param {number} distance - The distance in world units.
	* @return {Object3D} A reference to this instance.
	*/
	translateOnAxis(axis, distance) {
		_v1$6.copy(axis).applyQuaternion(this.quaternion);
		this.position.add(_v1$6.multiplyScalar(distance));
		return this;
	}
	/**
	* Translate the 3D object by a distance along its X-axis in local space.
	*
	* @param {number} distance - The distance in world units.
	* @return {Object3D} A reference to this instance.
	*/
	translateX(distance) {
		return this.translateOnAxis(_xAxis, distance);
	}
	/**
	* Translate the 3D object by a distance along its Y-axis in local space.
	*
	* @param {number} distance - The distance in world units.
	* @return {Object3D} A reference to this instance.
	*/
	translateY(distance) {
		return this.translateOnAxis(_yAxis, distance);
	}
	/**
	* Translate the 3D object by a distance along its Z-axis in local space.
	*
	* @param {number} distance - The distance in world units.
	* @return {Object3D} A reference to this instance.
	*/
	translateZ(distance) {
		return this.translateOnAxis(_zAxis, distance);
	}
	/**
	* Converts the given vector from this 3D object's local space to world space.
	*
	* @param {Vector3} vector - The vector to convert.
	* @return {Vector3} The converted vector.
	*/
	localToWorld(vector) {
		this.updateWorldMatrix(true, false);
		return vector.applyMatrix4(this.matrixWorld);
	}
	/**
	* Converts the given vector from this 3D object's world space to local space.
	*
	* @param {Vector3} vector - The vector to convert.
	* @return {Vector3} The converted vector.
	*/
	worldToLocal(vector) {
		this.updateWorldMatrix(true, false);
		return vector.applyMatrix4(_m1$1.copy(this.matrixWorld).invert());
	}
	/**
	* Rotates the object to face a point in world space.
	*
	* This method does not support objects having non-uniformly-scaled parent(s).
	*
	* @param {number|Vector3} x - The x coordinate in world space. Alternatively, a vector representing a position in world space
	* @param {number} [y] - The y coordinate in world space.
	* @param {number} [z] - The z coordinate in world space.
	*/
	lookAt(x, y, z) {
		if (x.isVector3) _target.copy(x);
		else _target.set(x, y, z);
		const parent = this.parent;
		this.updateWorldMatrix(true, false);
		_position$4.setFromMatrixPosition(this.matrixWorld);
		if (this.isCamera || this.isLight) _m1$1.lookAt(_position$4, _target, this.up);
		else _m1$1.lookAt(_target, _position$4, this.up);
		this.quaternion.setFromRotationMatrix(_m1$1);
		if (parent) {
			_m1$1.extractRotation(parent.matrixWorld);
			_q1$1.setFromRotationMatrix(_m1$1);
			this.quaternion.premultiply(_q1$1.invert());
		}
	}
	/**
	* Adds the given 3D object as a child to this 3D object. An arbitrary number of
	* objects may be added. Any current parent on an object passed in here will be
	* removed, since an object can have at most one parent.
	*
	* @fires Object3D#added
	* @fires Object3D#childadded
	* @param {Object3D} object - The 3D object to add.
	* @return {Object3D} A reference to this instance.
	*/
	add(object) {
		if (arguments.length > 1) {
			for (let i = 0; i < arguments.length; i++) this.add(arguments[i]);
			return this;
		}
		if (object === this) {
			error("Object3D.add: object can't be added as a child of itself.", object);
			return this;
		}
		if (object && object.isObject3D) {
			object.removeFromParent();
			object.parent = this;
			this.children.push(object);
			object.dispatchEvent(_addedEvent);
			_childaddedEvent.child = object;
			this.dispatchEvent(_childaddedEvent);
			_childaddedEvent.child = null;
		} else error("Object3D.add: object not an instance of THREE.Object3D.", object);
		return this;
	}
	/**
	* Removes the given 3D object as child from this 3D object.
	* An arbitrary number of objects may be removed.
	*
	* @fires Object3D#removed
	* @fires Object3D#childremoved
	* @param {Object3D} object - The 3D object to remove.
	* @return {Object3D} A reference to this instance.
	*/
	remove(object) {
		if (arguments.length > 1) {
			for (let i = 0; i < arguments.length; i++) this.remove(arguments[i]);
			return this;
		}
		const index = this.children.indexOf(object);
		if (index !== -1) {
			object.parent = null;
			this.children.splice(index, 1);
			object.dispatchEvent(_removedEvent);
			_childremovedEvent.child = object;
			this.dispatchEvent(_childremovedEvent);
			_childremovedEvent.child = null;
		}
		return this;
	}
	/**
	* Removes this 3D object from its current parent.
	*
	* @fires Object3D#removed
	* @fires Object3D#childremoved
	* @return {Object3D} A reference to this instance.
	*/
	removeFromParent() {
		const parent = this.parent;
		if (parent !== null) parent.remove(this);
		return this;
	}
	/**
	* Removes all child objects.
	*
	* @fires Object3D#removed
	* @fires Object3D#childremoved
	* @return {Object3D} A reference to this instance.
	*/
	clear() {
		return this.remove(...this.children);
	}
	/**
	* Adds the given 3D object as a child of this 3D object, while maintaining the object's world
	* transform. This method does not support scene graphs having non-uniformly-scaled nodes(s).
	*
	* @fires Object3D#added
	* @fires Object3D#childadded
	* @param {Object3D} object - The 3D object to attach.
	* @return {Object3D} A reference to this instance.
	*/
	attach(object) {
		this.updateWorldMatrix(true, false);
		_m1$1.copy(this.matrixWorld).invert();
		if (object.parent !== null) {
			object.parent.updateWorldMatrix(true, false);
			_m1$1.multiply(object.parent.matrixWorld);
		}
		object.applyMatrix4(_m1$1);
		object.removeFromParent();
		object.parent = this;
		this.children.push(object);
		object.updateWorldMatrix(false, true);
		object.dispatchEvent(_addedEvent);
		_childaddedEvent.child = object;
		this.dispatchEvent(_childaddedEvent);
		_childaddedEvent.child = null;
		return this;
	}
	/**
	* Searches through the 3D object and its children, starting with the 3D object
	* itself, and returns the first with a matching ID.
	*
	* @param {number} id - The id.
	* @return {Object3D|undefined} The found 3D object. Returns `undefined` if no 3D object has been found.
	*/
	getObjectById(id) {
		return this.getObjectByProperty("id", id);
	}
	/**
	* Searches through the 3D object and its children, starting with the 3D object
	* itself, and returns the first with a matching name.
	*
	* @param {string} name - The name.
	* @return {Object3D|undefined} The found 3D object. Returns `undefined` if no 3D object has been found.
	*/
	getObjectByName(name) {
		return this.getObjectByProperty("name", name);
	}
	/**
	* Searches through the 3D object and its children, starting with the 3D object
	* itself, and returns the first with a matching property value.
	*
	* @param {string} name - The name of the property.
	* @param {any} value - The value.
	* @return {Object3D|undefined} The found 3D object. Returns `undefined` if no 3D object has been found.
	*/
	getObjectByProperty(name, value) {
		if (this[name] === value) return this;
		for (let i = 0, l = this.children.length; i < l; i++) {
			const object = this.children[i].getObjectByProperty(name, value);
			if (object !== void 0) return object;
		}
	}
	/**
	* Searches through the 3D object and its children, starting with the 3D object
	* itself, and returns all 3D objects with a matching property value.
	*
	* @param {string} name - The name of the property.
	* @param {any} value - The value.
	* @param {Array<Object3D>} result - The method stores the result in this array.
	* @return {Array<Object3D>} The found 3D objects.
	*/
	getObjectsByProperty(name, value, result = []) {
		if (this[name] === value) result.push(this);
		const children = this.children;
		for (let i = 0, l = children.length; i < l; i++) children[i].getObjectsByProperty(name, value, result);
		return result;
	}
	/**
	* Returns a vector representing the position of the 3D object in world space.
	*
	* @param {Vector3} target - The target vector the result is stored to.
	* @return {Vector3} The 3D object's position in world space.
	*/
	getWorldPosition(target) {
		this.updateWorldMatrix(true, false);
		return target.setFromMatrixPosition(this.matrixWorld);
	}
	/**
	* Returns a Quaternion representing the position of the 3D object in world space.
	*
	* @param {Quaternion} target - The target Quaternion the result is stored to.
	* @return {Quaternion} The 3D object's rotation in world space.
	*/
	getWorldQuaternion(target) {
		this.updateWorldMatrix(true, false);
		this.matrixWorld.decompose(_position$4, target, _scale$3);
		return target;
	}
	/**
	* Returns a vector representing the scale of the 3D object in world space.
	*
	* @param {Vector3} target - The target vector the result is stored to.
	* @return {Vector3} The 3D object's scale in world space.
	*/
	getWorldScale(target) {
		this.updateWorldMatrix(true, false);
		this.matrixWorld.decompose(_position$4, _quaternion$3, target);
		return target;
	}
	/**
	* Returns a vector representing the ("look") direction of the 3D object in world space.
	*
	* @param {Vector3} target - The target vector the result is stored to.
	* @return {Vector3} The 3D object's direction in world space.
	*/
	getWorldDirection(target) {
		this.updateWorldMatrix(true, false);
		const e = this.matrixWorld.elements;
		return target.set(e[8], e[9], e[10]).normalize();
	}
	/**
	* Abstract method to get intersections between a casted ray and this
	* 3D object. Renderable 3D objects such as {@link Mesh}, {@link Line} or {@link Points}
	* implement this method in order to use raycasting.
	*
	* @abstract
	* @param {Raycaster} raycaster - The raycaster.
	* @param {Array<Object>} intersects - An array holding the result of the method.
	*/
	raycast() {}
	/**
	* Executes the callback on this 3D object and all descendants.
	*
	* Note: Modifying the scene graph inside the callback is discouraged.
	*
	* @param {Function} callback - A callback function that allows to process the current 3D object.
	*/
	traverse(callback) {
		callback(this);
		const children = this.children;
		for (let i = 0, l = children.length; i < l; i++) children[i].traverse(callback);
	}
	/**
	* Like {@link Object3D#traverse}, but the callback will only be executed for visible 3D objects.
	* Descendants of invisible 3D objects are not traversed.
	*
	* Note: Modifying the scene graph inside the callback is discouraged.
	*
	* @param {Function} callback - A callback function that allows to process the current 3D object.
	*/
	traverseVisible(callback) {
		if (this.visible === false) return;
		callback(this);
		const children = this.children;
		for (let i = 0, l = children.length; i < l; i++) children[i].traverseVisible(callback);
	}
	/**
	* Like {@link Object3D#traverse}, but the callback will only be executed for all ancestors.
	*
	* Note: Modifying the scene graph inside the callback is discouraged.
	*
	* @param {Function} callback - A callback function that allows to process the current 3D object.
	*/
	traverseAncestors(callback) {
		const parent = this.parent;
		if (parent !== null) {
			callback(parent);
			parent.traverseAncestors(callback);
		}
	}
	/**
	* Updates the transformation matrix in local space by computing it from the current
	* position, rotation and scale values.
	*/
	updateMatrix() {
		this.matrix.compose(this.position, this.quaternion, this.scale);
		const pivot = this.pivot;
		if (pivot !== null) {
			const px = pivot.x, py = pivot.y, pz = pivot.z;
			const te = this.matrix.elements;
			te[12] += px - te[0] * px - te[4] * py - te[8] * pz;
			te[13] += py - te[1] * px - te[5] * py - te[9] * pz;
			te[14] += pz - te[2] * px - te[6] * py - te[10] * pz;
		}
		this.matrixWorldNeedsUpdate = true;
	}
	/**
	* Updates the transformation matrix in world space of this 3D objects and its descendants.
	*
	* To ensure correct results, this method also recomputes the 3D object's transformation matrix in
	* local space. The computation of the local and world matrix can be controlled with the
	* {@link Object3D#matrixAutoUpdate} and {@link Object3D#matrixWorldAutoUpdate} flags which are both
	* `true` by default.  Set these flags to `false` if you need more control over the update matrix process.
	*
	* @param {boolean} [force=false] - When set to `true`, a recomputation of world matrices is forced even
	* when {@link Object3D#matrixWorldNeedsUpdate} is `false`.
	*/
	updateMatrixWorld(force) {
		if (this.matrixAutoUpdate) this.updateMatrix();
		if (this.matrixWorldNeedsUpdate || force) {
			if (this.matrixWorldAutoUpdate === true) if (this.parent === null) this.matrixWorld.copy(this.matrix);
			else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
			this.matrixWorldNeedsUpdate = false;
			force = true;
		}
		const children = this.children;
		for (let i = 0, l = children.length; i < l; i++) children[i].updateMatrixWorld(force);
	}
	/**
	* An alternative version of {@link Object3D#updateMatrixWorld} with more control over the
	* update of ancestor and descendant nodes.
	*
	* @param {boolean} [updateParents=false] Whether ancestor nodes should be updated or not.
	* @param {boolean} [updateChildren=false] Whether descendant nodes should be updated or not.
	* @param {boolean} [force=false] - When set to `true`, a recomputation of world matrices is forced even
	* when {@link Object3D#matrixWorldNeedsUpdate} is `false`.
	*/
	updateWorldMatrix(updateParents, updateChildren, force = false) {
		const parent = this.parent;
		if (updateParents === true && parent !== null) parent.updateWorldMatrix(true, false);
		if (this.matrixAutoUpdate) this.updateMatrix();
		if (this.matrixWorldNeedsUpdate || force) {
			if (this.matrixWorldAutoUpdate === true) if (this.parent === null) this.matrixWorld.copy(this.matrix);
			else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
			this.matrixWorldNeedsUpdate = false;
			force = true;
		}
		if (updateChildren === true) {
			const children = this.children;
			for (let i = 0, l = children.length; i < l; i++) children[i].updateWorldMatrix(false, true, force);
		}
	}
	/**
	* Serializes the 3D object into JSON.
	*
	* @param {?(Object|string)} meta - An optional value holding meta information about the serialization.
	* @return {Object} A JSON object representing the serialized 3D object.
	* @see {@link ObjectLoader#parse}
	*/
	toJSON(meta) {
		const isRootObject = meta === void 0 || typeof meta === "string";
		const output = {};
		if (isRootObject) {
			meta = {
				geometries: {},
				materials: {},
				textures: {},
				images: {},
				shapes: {},
				skeletons: {},
				animations: {},
				nodes: {}
			};
			output.metadata = {
				version: 4.7,
				type: "Object",
				generator: "Object3D.toJSON"
			};
		}
		const object = {};
		object.uuid = this.uuid;
		object.type = this.type;
		if (this.name !== "") object.name = this.name;
		if (this.castShadow === true) object.castShadow = true;
		if (this.receiveShadow === true) object.receiveShadow = true;
		if (this.visible === false) object.visible = false;
		if (this.frustumCulled === false) object.frustumCulled = false;
		if (this.renderOrder !== 0) object.renderOrder = this.renderOrder;
		if (this.static !== false) object.static = this.static;
		if (Object.keys(this.userData).length > 0) object.userData = this.userData;
		object.layers = this.layers.mask;
		object.matrix = this.matrix.toArray();
		object.up = this.up.toArray();
		if (this.pivot !== null) object.pivot = this.pivot.toArray();
		if (this.matrixAutoUpdate === false) object.matrixAutoUpdate = false;
		if (this.morphTargetDictionary !== void 0) object.morphTargetDictionary = Object.assign({}, this.morphTargetDictionary);
		if (this.morphTargetInfluences !== void 0) object.morphTargetInfluences = this.morphTargetInfluences.slice();
		if (this.isInstancedMesh) {
			object.type = "InstancedMesh";
			object.count = this.count;
			object.instanceMatrix = this.instanceMatrix.toJSON();
			if (this.instanceColor !== null) object.instanceColor = this.instanceColor.toJSON();
		}
		if (this.isBatchedMesh) {
			object.type = "BatchedMesh";
			object.perObjectFrustumCulled = this.perObjectFrustumCulled;
			object.sortObjects = this.sortObjects;
			object.drawRanges = this._drawRanges;
			object.reservedRanges = this._reservedRanges;
			object.geometryInfo = this._geometryInfo.map((info) => ({
				...info,
				boundingBox: info.boundingBox ? info.boundingBox.toJSON() : void 0,
				boundingSphere: info.boundingSphere ? info.boundingSphere.toJSON() : void 0
			}));
			object.instanceInfo = this._instanceInfo.map((info) => ({ ...info }));
			object.availableInstanceIds = this._availableInstanceIds.slice();
			object.availableGeometryIds = this._availableGeometryIds.slice();
			object.nextIndexStart = this._nextIndexStart;
			object.nextVertexStart = this._nextVertexStart;
			object.geometryCount = this._geometryCount;
			object.maxInstanceCount = this._maxInstanceCount;
			object.maxVertexCount = this._maxVertexCount;
			object.maxIndexCount = this._maxIndexCount;
			object.geometryInitialized = this._geometryInitialized;
			object.matricesTexture = this._matricesTexture.toJSON(meta);
			object.indirectTexture = this._indirectTexture.toJSON(meta);
			if (this._colorsTexture !== null) object.colorsTexture = this._colorsTexture.toJSON(meta);
			if (this.boundingSphere !== null) object.boundingSphere = this.boundingSphere.toJSON();
			if (this.boundingBox !== null) object.boundingBox = this.boundingBox.toJSON();
		}
		function serialize(library, element) {
			if (library[element.uuid] === void 0) library[element.uuid] = element.toJSON(meta);
			return element.uuid;
		}
		if (this.isScene) {
			if (this.background) {
				if (this.background.isColor) object.background = this.background.toJSON();
				else if (this.background.isTexture) object.background = this.background.toJSON(meta).uuid;
			}
			if (this.environment && this.environment.isTexture && this.environment.isRenderTargetTexture !== true) object.environment = this.environment.toJSON(meta).uuid;
		} else if (this.isMesh || this.isLine || this.isPoints) {
			object.geometry = serialize(meta.geometries, this.geometry);
			const parameters = this.geometry.parameters;
			if (parameters !== void 0 && parameters.shapes !== void 0) {
				const shapes = parameters.shapes;
				if (Array.isArray(shapes)) for (let i = 0, l = shapes.length; i < l; i++) {
					const shape = shapes[i];
					serialize(meta.shapes, shape);
				}
				else serialize(meta.shapes, shapes);
			}
		}
		if (this.isSkinnedMesh) {
			object.bindMode = this.bindMode;
			object.bindMatrix = this.bindMatrix.toArray();
			if (this.skeleton !== void 0) {
				serialize(meta.skeletons, this.skeleton);
				object.skeleton = this.skeleton.uuid;
			}
		}
		if (this.material !== void 0) if (Array.isArray(this.material)) {
			const uuids = [];
			for (let i = 0, l = this.material.length; i < l; i++) uuids.push(serialize(meta.materials, this.material[i]));
			object.material = uuids;
		} else object.material = serialize(meta.materials, this.material);
		if (this.children.length > 0) {
			object.children = [];
			for (let i = 0; i < this.children.length; i++) object.children.push(this.children[i].toJSON(meta).object);
		}
		if (this.animations.length > 0) {
			object.animations = [];
			for (let i = 0; i < this.animations.length; i++) {
				const animation = this.animations[i];
				object.animations.push(serialize(meta.animations, animation));
			}
		}
		if (isRootObject) {
			const geometries = extractFromCache(meta.geometries);
			const materials = extractFromCache(meta.materials);
			const textures = extractFromCache(meta.textures);
			const images = extractFromCache(meta.images);
			const shapes = extractFromCache(meta.shapes);
			const skeletons = extractFromCache(meta.skeletons);
			const animations = extractFromCache(meta.animations);
			const nodes = extractFromCache(meta.nodes);
			if (geometries.length > 0) output.geometries = geometries;
			if (materials.length > 0) output.materials = materials;
			if (textures.length > 0) output.textures = textures;
			if (images.length > 0) output.images = images;
			if (shapes.length > 0) output.shapes = shapes;
			if (skeletons.length > 0) output.skeletons = skeletons;
			if (animations.length > 0) output.animations = animations;
			if (nodes.length > 0) output.nodes = nodes;
		}
		output.object = object;
		return output;
		function extractFromCache(cache) {
			const values = [];
			for (const key in cache) {
				const data = cache[key];
				delete data.metadata;
				values.push(data);
			}
			return values;
		}
	}
	/**
	* Returns a new 3D object with copied values from this instance.
	*
	* @param {boolean} [recursive=true] - When set to `true`, descendants of the 3D object are also cloned.
	* @return {Object3D} A clone of this instance.
	*/
	clone(recursive) {
		return new this.constructor().copy(this, recursive);
	}
	/**
	* Copies the values of the given 3D object to this instance.
	*
	* @param {Object3D} source - The 3D object to copy.
	* @param {boolean} [recursive=true] - When set to `true`, descendants of the 3D object are cloned.
	* @return {Object3D} A reference to this instance.
	*/
	copy(source, recursive = true) {
		this.name = source.name;
		this.up.copy(source.up);
		this.position.copy(source.position);
		this.rotation.order = source.rotation.order;
		this.quaternion.copy(source.quaternion);
		this.scale.copy(source.scale);
		this.pivot = source.pivot !== null ? source.pivot.clone() : null;
		this.matrix.copy(source.matrix);
		this.matrixWorld.copy(source.matrixWorld);
		this.matrixAutoUpdate = source.matrixAutoUpdate;
		this.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
		this.matrixWorldNeedsUpdate = source.matrixWorldNeedsUpdate;
		this.layers.mask = source.layers.mask;
		this.visible = source.visible;
		this.castShadow = source.castShadow;
		this.receiveShadow = source.receiveShadow;
		this.frustumCulled = source.frustumCulled;
		this.renderOrder = source.renderOrder;
		this.static = source.static;
		this.animations = source.animations.slice();
		this.userData = JSON.parse(JSON.stringify(source.userData));
		if (recursive === true) for (let i = 0; i < source.children.length; i++) {
			const child = source.children[i];
			this.add(child.clone());
		}
		return this;
	}
};
/**
* The default up direction for objects, also used as the default
* position for {@link DirectionalLight} and {@link HemisphereLight}.
*
* @static
* @type {Vector3}
* @default (0,1,0)
*/
Object3D.DEFAULT_UP = /*@__PURE__*/ new Vector3(0, 1, 0);
/**
* The default setting for {@link Object3D#matrixAutoUpdate} for
* newly created 3D objects.
*
* @static
* @type {boolean}
* @default true
*/
Object3D.DEFAULT_MATRIX_AUTO_UPDATE = true;
/**
* The default setting for {@link Object3D#matrixWorldAutoUpdate} for
* newly created 3D objects.
*
* @static
* @type {boolean}
* @default true
*/
Object3D.DEFAULT_MATRIX_WORLD_AUTO_UPDATE = true;
/**
* This is almost identical to an {@link Object3D}. Its purpose is to
* make working with groups of objects syntactically clearer.
*
* ```js
* // Create a group and add the two cubes.
* // These cubes can now be rotated / scaled etc as a group.
* const group = new THREE.Group();
*
* group.add( meshA );
* group.add( meshB );
*
* scene.add( group );
* ```
*
* @augments Object3D
*/
var Group = class extends Object3D {
	constructor() {
		super();
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isGroup = true;
		this.type = "Group";
	}
};
const _colorKeywords = {
	"aliceblue": 15792383,
	"antiquewhite": 16444375,
	"aqua": 65535,
	"aquamarine": 8388564,
	"azure": 15794175,
	"beige": 16119260,
	"bisque": 16770244,
	"black": 0,
	"blanchedalmond": 16772045,
	"blue": 255,
	"blueviolet": 9055202,
	"brown": 10824234,
	"burlywood": 14596231,
	"cadetblue": 6266528,
	"chartreuse": 8388352,
	"chocolate": 13789470,
	"coral": 16744272,
	"cornflowerblue": 6591981,
	"cornsilk": 16775388,
	"crimson": 14423100,
	"cyan": 65535,
	"darkblue": 139,
	"darkcyan": 35723,
	"darkgoldenrod": 12092939,
	"darkgray": 11119017,
	"darkgreen": 25600,
	"darkgrey": 11119017,
	"darkkhaki": 12433259,
	"darkmagenta": 9109643,
	"darkolivegreen": 5597999,
	"darkorange": 16747520,
	"darkorchid": 10040012,
	"darkred": 9109504,
	"darksalmon": 15308410,
	"darkseagreen": 9419919,
	"darkslateblue": 4734347,
	"darkslategray": 3100495,
	"darkslategrey": 3100495,
	"darkturquoise": 52945,
	"darkviolet": 9699539,
	"deeppink": 16716947,
	"deepskyblue": 49151,
	"dimgray": 6908265,
	"dimgrey": 6908265,
	"dodgerblue": 2003199,
	"firebrick": 11674146,
	"floralwhite": 16775920,
	"forestgreen": 2263842,
	"fuchsia": 16711935,
	"gainsboro": 14474460,
	"ghostwhite": 16316671,
	"gold": 16766720,
	"goldenrod": 14329120,
	"gray": 8421504,
	"green": 32768,
	"greenyellow": 11403055,
	"grey": 8421504,
	"honeydew": 15794160,
	"hotpink": 16738740,
	"indianred": 13458524,
	"indigo": 4915330,
	"ivory": 16777200,
	"khaki": 15787660,
	"lavender": 15132410,
	"lavenderblush": 16773365,
	"lawngreen": 8190976,
	"lemonchiffon": 16775885,
	"lightblue": 11393254,
	"lightcoral": 15761536,
	"lightcyan": 14745599,
	"lightgoldenrodyellow": 16448210,
	"lightgray": 13882323,
	"lightgreen": 9498256,
	"lightgrey": 13882323,
	"lightpink": 16758465,
	"lightsalmon": 16752762,
	"lightseagreen": 2142890,
	"lightskyblue": 8900346,
	"lightslategray": 7833753,
	"lightslategrey": 7833753,
	"lightsteelblue": 11584734,
	"lightyellow": 16777184,
	"lime": 65280,
	"limegreen": 3329330,
	"linen": 16445670,
	"magenta": 16711935,
	"maroon": 8388608,
	"mediumaquamarine": 6737322,
	"mediumblue": 205,
	"mediumorchid": 12211667,
	"mediumpurple": 9662683,
	"mediumseagreen": 3978097,
	"mediumslateblue": 8087790,
	"mediumspringgreen": 64154,
	"mediumturquoise": 4772300,
	"mediumvioletred": 13047173,
	"midnightblue": 1644912,
	"mintcream": 16121850,
	"mistyrose": 16770273,
	"moccasin": 16770229,
	"navajowhite": 16768685,
	"navy": 128,
	"oldlace": 16643558,
	"olive": 8421376,
	"olivedrab": 7048739,
	"orange": 16753920,
	"orangered": 16729344,
	"orchid": 14315734,
	"palegoldenrod": 15657130,
	"palegreen": 10025880,
	"paleturquoise": 11529966,
	"palevioletred": 14381203,
	"papayawhip": 16773077,
	"peachpuff": 16767673,
	"peru": 13468991,
	"pink": 16761035,
	"plum": 14524637,
	"powderblue": 11591910,
	"purple": 8388736,
	"rebeccapurple": 6697881,
	"red": 16711680,
	"rosybrown": 12357519,
	"royalblue": 4286945,
	"saddlebrown": 9127187,
	"salmon": 16416882,
	"sandybrown": 16032864,
	"seagreen": 3050327,
	"seashell": 16774638,
	"sienna": 10506797,
	"silver": 12632256,
	"skyblue": 8900331,
	"slateblue": 6970061,
	"slategray": 7372944,
	"slategrey": 7372944,
	"snow": 16775930,
	"springgreen": 65407,
	"steelblue": 4620980,
	"tan": 13808780,
	"teal": 32896,
	"thistle": 14204888,
	"tomato": 16737095,
	"turquoise": 4251856,
	"violet": 15631086,
	"wheat": 16113331,
	"white": 16777215,
	"whitesmoke": 16119285,
	"yellow": 16776960,
	"yellowgreen": 10145074
};
const _hslA = {
	h: 0,
	s: 0,
	l: 0
};
const _hslB = {
	h: 0,
	s: 0,
	l: 0
};
function hue2rgb(p, q, t) {
	if (t < 0) t += 1;
	if (t > 1) t -= 1;
	if (t < 1 / 6) return p + (q - p) * 6 * t;
	if (t < 1 / 2) return q;
	if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
	return p;
}
/**
* A Color instance is represented by RGB components in the linear <i>working
* color space</i>, which defaults to `LinearSRGBColorSpace`. Inputs
* conventionally using `SRGBColorSpace` (such as hexadecimals and CSS
* strings) are converted to the working color space automatically.
*
* ```js
* // converted automatically from SRGBColorSpace to LinearSRGBColorSpace
* const color = new THREE.Color().setHex( 0x112233 );
* ```
* Source color spaces may be specified explicitly, to ensure correct conversions.
* ```js
* // assumed already LinearSRGBColorSpace; no conversion
* const color = new THREE.Color().setRGB( 0.5, 0.5, 0.5 );
*
* // converted explicitly from SRGBColorSpace to LinearSRGBColorSpace
* const color = new THREE.Color().setRGB( 0.5, 0.5, 0.5, SRGBColorSpace );
* ```
* If THREE.ColorManagement is disabled, no conversions occur. For details,
* see <i>Color management</i>. Iterating through a Color instance will yield
* its components (r, g, b) in the corresponding order. A Color can be initialised
* in any of the following ways:
* ```js
* //empty constructor - will default white
* const color1 = new THREE.Color();
*
* //Hexadecimal color (recommended)
* const color2 = new THREE.Color( 0xff0000 );
*
* //RGB string
* const color3 = new THREE.Color("rgb(255, 0, 0)");
* const color4 = new THREE.Color("rgb(100%, 0%, 0%)");
*
* //X11 color name - all 140 color names are supported.
* //Note the lack of CamelCase in the name
* const color5 = new THREE.Color( 'skyblue' );
* //HSL string
* const color6 = new THREE.Color("hsl(0, 100%, 50%)");
*
* //Separate RGB values between 0 and 1
* const color7 = new THREE.Color( 1, 0, 0 );
* ```
*/
var Color = class {
	/**
	* Constructs a new color.
	*
	* Note that standard method of specifying color in three.js is with a hexadecimal triplet,
	* and that method is used throughout the rest of the documentation.
	*
	* @param {(number|string|Color)} [r] - The red component of the color. If `g` and `b` are
	* not provided, it can be hexadecimal triplet, a CSS-style string or another `Color` instance.
	* @param {number} [g] - The green component.
	* @param {number} [b] - The blue component.
	*/
	constructor(r, g, b) {
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isColor = true;
		/**
		* The red component.
		*
		* @type {number}
		* @default 1
		*/
		this.r = 1;
		/**
		* The green component.
		*
		* @type {number}
		* @default 1
		*/
		this.g = 1;
		/**
		* The blue component.
		*
		* @type {number}
		* @default 1
		*/
		this.b = 1;
		return this.set(r, g, b);
	}
	/**
	* Sets the colors's components from the given values.
	*
	* @param {(number|string|Color)} [r] - The red component of the color. If `g` and `b` are
	* not provided, it can be hexadecimal triplet, a CSS-style string or another `Color` instance.
	* @param {number} [g] - The green component.
	* @param {number} [b] - The blue component.
	* @return {Color} A reference to this color.
	*/
	set(r, g, b) {
		if (g === void 0 && b === void 0) {
			const value = r;
			if (value && value.isColor) this.copy(value);
			else if (typeof value === "number") this.setHex(value);
			else if (typeof value === "string") this.setStyle(value);
		} else this.setRGB(r, g, b);
		return this;
	}
	/**
	* Sets the colors's components to the given scalar value.
	*
	* @param {number} scalar - The scalar value.
	* @return {Color} A reference to this color.
	*/
	setScalar(scalar) {
		this.r = scalar;
		this.g = scalar;
		this.b = scalar;
		return this;
	}
	/**
	* Sets this color from a hexadecimal value.
	*
	* @param {number} hex - The hexadecimal value.
	* @param {string} [colorSpace=SRGBColorSpace] - The color space.
	* @return {Color} A reference to this color.
	*/
	setHex(hex, colorSpace = SRGBColorSpace) {
		hex = Math.floor(hex);
		this.r = (hex >> 16 & 255) / 255;
		this.g = (hex >> 8 & 255) / 255;
		this.b = (hex & 255) / 255;
		ColorManagement.colorSpaceToWorking(this, colorSpace);
		return this;
	}
	/**
	* Sets this color from RGB values.
	*
	* @param {number} r - Red channel value between `0.0` and `1.0`.
	* @param {number} g - Green channel value between `0.0` and `1.0`.
	* @param {number} b - Blue channel value between `0.0` and `1.0`.
	* @param {string} [colorSpace=ColorManagement.workingColorSpace] - The color space.
	* @return {Color} A reference to this color.
	*/
	setRGB(r, g, b, colorSpace = ColorManagement.workingColorSpace) {
		this.r = r;
		this.g = g;
		this.b = b;
		ColorManagement.colorSpaceToWorking(this, colorSpace);
		return this;
	}
	/**
	* Sets this color from RGB values.
	*
	* @param {number} h - Hue value between `0.0` and `1.0`.
	* @param {number} s - Saturation value between `0.0` and `1.0`.
	* @param {number} l - Lightness value between `0.0` and `1.0`.
	* @param {string} [colorSpace=ColorManagement.workingColorSpace] - The color space.
	* @return {Color} A reference to this color.
	*/
	setHSL(h, s, l, colorSpace = ColorManagement.workingColorSpace) {
		h = euclideanModulo(h, 1);
		s = clamp$1(s, 0, 1);
		l = clamp$1(l, 0, 1);
		if (s === 0) this.r = this.g = this.b = l;
		else {
			const p = l <= .5 ? l * (1 + s) : l + s - l * s;
			const q = 2 * l - p;
			this.r = hue2rgb(q, p, h + 1 / 3);
			this.g = hue2rgb(q, p, h);
			this.b = hue2rgb(q, p, h - 1 / 3);
		}
		ColorManagement.colorSpaceToWorking(this, colorSpace);
		return this;
	}
	/**
	* Sets this color from a CSS-style string. For example, `rgb(250, 0,0)`,
	* `rgb(100%, 0%, 0%)`, `hsl(0, 100%, 50%)`, `#ff0000`, `#f00`, or `red` ( or
	* any [X11 color name](https://en.wikipedia.org/wiki/X11_color_names#Color_name_chart) -
	* all 140 color names are supported).
	*
	* @param {string} style - Color as a CSS-style string.
	* @param {string} [colorSpace=SRGBColorSpace] - The color space.
	* @return {Color} A reference to this color.
	*/
	setStyle(style, colorSpace = SRGBColorSpace) {
		function handleAlpha(string) {
			if (string === void 0) return;
			if (parseFloat(string) < 1) warn("Color: Alpha component of " + style + " will be ignored.");
		}
		let m;
		if (m = /^(\w+)\(([^\)]*)\)/.exec(style)) {
			let color;
			const name = m[1];
			const components = m[2];
			switch (name) {
				case "rgb":
				case "rgba":
					if (color = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(components)) {
						handleAlpha(color[4]);
						return this.setRGB(Math.min(255, parseInt(color[1], 10)) / 255, Math.min(255, parseInt(color[2], 10)) / 255, Math.min(255, parseInt(color[3], 10)) / 255, colorSpace);
					}
					if (color = /^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(components)) {
						handleAlpha(color[4]);
						return this.setRGB(Math.min(100, parseInt(color[1], 10)) / 100, Math.min(100, parseInt(color[2], 10)) / 100, Math.min(100, parseInt(color[3], 10)) / 100, colorSpace);
					}
					break;
				case "hsl":
				case "hsla":
					if (color = /^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(components)) {
						handleAlpha(color[4]);
						return this.setHSL(parseFloat(color[1]) / 360, parseFloat(color[2]) / 100, parseFloat(color[3]) / 100, colorSpace);
					}
					break;
				default: warn("Color: Unknown color model " + style);
			}
		} else if (m = /^\#([A-Fa-f\d]+)$/.exec(style)) {
			const hex = m[1];
			const size = hex.length;
			if (size === 3) return this.setRGB(parseInt(hex.charAt(0), 16) / 15, parseInt(hex.charAt(1), 16) / 15, parseInt(hex.charAt(2), 16) / 15, colorSpace);
			else if (size === 6) return this.setHex(parseInt(hex, 16), colorSpace);
			else warn("Color: Invalid hex color " + style);
		} else if (style && style.length > 0) return this.setColorName(style, colorSpace);
		return this;
	}
	/**
	* Sets this color from a color name. Faster than {@link Color#setStyle} if
	* you don't need the other CSS-style formats.
	*
	* For convenience, the list of names is exposed in `Color.NAMES` as a hash.
	* ```js
	* Color.NAMES.aliceblue // returns 0xF0F8FF
	* ```
	*
	* @param {string} style - The color name.
	* @param {string} [colorSpace=SRGBColorSpace] - The color space.
	* @return {Color} A reference to this color.
	*/
	setColorName(style, colorSpace = SRGBColorSpace) {
		const hex = _colorKeywords[style.toLowerCase()];
		if (hex !== void 0) this.setHex(hex, colorSpace);
		else warn("Color: Unknown color " + style);
		return this;
	}
	/**
	* Returns a new color with copied values from this instance.
	*
	* @return {Color} A clone of this instance.
	*/
	clone() {
		return new this.constructor(this.r, this.g, this.b);
	}
	/**
	* Copies the values of the given color to this instance.
	*
	* @param {Color} color - The color to copy.
	* @return {Color} A reference to this color.
	*/
	copy(color) {
		this.r = color.r;
		this.g = color.g;
		this.b = color.b;
		return this;
	}
	/**
	* Copies the given color into this color, and then converts this color from
	* `SRGBColorSpace` to `LinearSRGBColorSpace`.
	*
	* @param {Color} color - The color to copy/convert.
	* @return {Color} A reference to this color.
	*/
	copySRGBToLinear(color) {
		this.r = SRGBToLinear(color.r);
		this.g = SRGBToLinear(color.g);
		this.b = SRGBToLinear(color.b);
		return this;
	}
	/**
	* Copies the given color into this color, and then converts this color from
	* `LinearSRGBColorSpace` to `SRGBColorSpace`.
	*
	* @param {Color} color - The color to copy/convert.
	* @return {Color} A reference to this color.
	*/
	copyLinearToSRGB(color) {
		this.r = LinearToSRGB(color.r);
		this.g = LinearToSRGB(color.g);
		this.b = LinearToSRGB(color.b);
		return this;
	}
	/**
	* Converts this color from `SRGBColorSpace` to `LinearSRGBColorSpace`.
	*
	* @return {Color} A reference to this color.
	*/
	convertSRGBToLinear() {
		this.copySRGBToLinear(this);
		return this;
	}
	/**
	* Converts this color from `LinearSRGBColorSpace` to `SRGBColorSpace`.
	*
	* @return {Color} A reference to this color.
	*/
	convertLinearToSRGB() {
		this.copyLinearToSRGB(this);
		return this;
	}
	/**
	* Returns the hexadecimal value of this color.
	*
	* @param {string} [colorSpace=SRGBColorSpace] - The color space.
	* @return {number} The hexadecimal value.
	*/
	getHex(colorSpace = SRGBColorSpace) {
		ColorManagement.workingToColorSpace(_color.copy(this), colorSpace);
		return Math.round(clamp$1(_color.r * 255, 0, 255)) * 65536 + Math.round(clamp$1(_color.g * 255, 0, 255)) * 256 + Math.round(clamp$1(_color.b * 255, 0, 255));
	}
	/**
	* Returns the hexadecimal value of this color as a string (for example, 'FFFFFF').
	*
	* @param {string} [colorSpace=SRGBColorSpace] - The color space.
	* @return {string} The hexadecimal value as a string.
	*/
	getHexString(colorSpace = SRGBColorSpace) {
		return ("000000" + this.getHex(colorSpace).toString(16)).slice(-6);
	}
	/**
	* Converts the colors RGB values into the HSL format and stores them into the
	* given target object.
	*
	* @param {{h:number,s:number,l:number}} target - The target object that is used to store the method's result.
	* @param {string} [colorSpace=ColorManagement.workingColorSpace] - The color space.
	* @return {{h:number,s:number,l:number}} The HSL representation of this color.
	*/
	getHSL(target, colorSpace = ColorManagement.workingColorSpace) {
		ColorManagement.workingToColorSpace(_color.copy(this), colorSpace);
		const r = _color.r, g = _color.g, b = _color.b;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		let hue, saturation;
		const lightness = (min + max) / 2;
		if (min === max) {
			hue = 0;
			saturation = 0;
		} else {
			const delta = max - min;
			saturation = lightness <= .5 ? delta / (max + min) : delta / (2 - max - min);
			switch (max) {
				case r:
					hue = (g - b) / delta + (g < b ? 6 : 0);
					break;
				case g:
					hue = (b - r) / delta + 2;
					break;
				case b: hue = (r - g) / delta + 4;
			}
			hue /= 6;
		}
		target.h = hue;
		target.s = saturation;
		target.l = lightness;
		return target;
	}
	/**
	* Returns the RGB values of this color and stores them into the given target object.
	*
	* @param {Color} target - The target color that is used to store the method's result.
	* @param {string} [colorSpace=ColorManagement.workingColorSpace] - The color space.
	* @return {Color} The RGB representation of this color.
	*/
	getRGB(target, colorSpace = ColorManagement.workingColorSpace) {
		ColorManagement.workingToColorSpace(_color.copy(this), colorSpace);
		target.r = _color.r;
		target.g = _color.g;
		target.b = _color.b;
		return target;
	}
	/**
	* Returns the value of this color as a CSS style string. Example: `rgb(255,0,0)`.
	*
	* @param {string} [colorSpace=SRGBColorSpace] - The color space.
	* @return {string} The CSS representation of this color.
	*/
	getStyle(colorSpace = SRGBColorSpace) {
		ColorManagement.workingToColorSpace(_color.copy(this), colorSpace);
		const r = _color.r, g = _color.g, b = _color.b;
		if (colorSpace !== "srgb") return `color(${colorSpace} ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)})`;
		return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
	}
	/**
	* Adds the given HSL values to this color's values.
	* Internally, this converts the color's RGB values to HSL, adds HSL
	* and then converts the color back to RGB.
	*
	* @param {number} h - Hue value between `0.0` and `1.0`.
	* @param {number} s - Saturation value between `0.0` and `1.0`.
	* @param {number} l - Lightness value between `0.0` and `1.0`.
	* @return {Color} A reference to this color.
	*/
	offsetHSL(h, s, l) {
		this.getHSL(_hslA);
		return this.setHSL(_hslA.h + h, _hslA.s + s, _hslA.l + l);
	}
	/**
	* Adds the RGB values of the given color to the RGB values of this color.
	*
	* @param {Color} color - The color to add.
	* @return {Color} A reference to this color.
	*/
	add(color) {
		this.r += color.r;
		this.g += color.g;
		this.b += color.b;
		return this;
	}
	/**
	* Adds the RGB values of the given colors and stores the result in this instance.
	*
	* @param {Color} color1 - The first color.
	* @param {Color} color2 - The second color.
	* @return {Color} A reference to this color.
	*/
	addColors(color1, color2) {
		this.r = color1.r + color2.r;
		this.g = color1.g + color2.g;
		this.b = color1.b + color2.b;
		return this;
	}
	/**
	* Adds the given scalar value to the RGB values of this color.
	*
	* @param {number} s - The scalar to add.
	* @return {Color} A reference to this color.
	*/
	addScalar(s) {
		this.r += s;
		this.g += s;
		this.b += s;
		return this;
	}
	/**
	* Subtracts the RGB values of the given color from the RGB values of this color.
	*
	* @param {Color} color - The color to subtract.
	* @return {Color} A reference to this color.
	*/
	sub(color) {
		this.r = Math.max(0, this.r - color.r);
		this.g = Math.max(0, this.g - color.g);
		this.b = Math.max(0, this.b - color.b);
		return this;
	}
	/**
	* Multiplies the RGB values of the given color with the RGB values of this color.
	*
	* @param {Color} color - The color to multiply.
	* @return {Color} A reference to this color.
	*/
	multiply(color) {
		this.r *= color.r;
		this.g *= color.g;
		this.b *= color.b;
		return this;
	}
	/**
	* Multiplies the given scalar value with the RGB values of this color.
	*
	* @param {number} s - The scalar to multiply.
	* @return {Color} A reference to this color.
	*/
	multiplyScalar(s) {
		this.r *= s;
		this.g *= s;
		this.b *= s;
		return this;
	}
	/**
	* Linearly interpolates this color's RGB values toward the RGB values of the
	* given color. The alpha argument can be thought of as the ratio between
	* the two colors, where `0.0` is this color and `1.0` is the first argument.
	*
	* @param {Color} color - The color to converge on.
	* @param {number} alpha - The interpolation factor in the closed interval `[0,1]`.
	* @return {Color} A reference to this color.
	*/
	lerp(color, alpha) {
		this.r += (color.r - this.r) * alpha;
		this.g += (color.g - this.g) * alpha;
		this.b += (color.b - this.b) * alpha;
		return this;
	}
	/**
	* Linearly interpolates between the given colors and stores the result in this instance.
	* The alpha argument can be thought of as the ratio between the two colors, where `0.0`
	* is the first and `1.0` is the second color.
	*
	* @param {Color} color1 - The first color.
	* @param {Color} color2 - The second color.
	* @param {number} alpha - The interpolation factor in the closed interval `[0,1]`.
	* @return {Color} A reference to this color.
	*/
	lerpColors(color1, color2, alpha) {
		this.r = color1.r + (color2.r - color1.r) * alpha;
		this.g = color1.g + (color2.g - color1.g) * alpha;
		this.b = color1.b + (color2.b - color1.b) * alpha;
		return this;
	}
	/**
	* Linearly interpolates this color's HSL values toward the HSL values of the
	* given color. It differs from {@link Color#lerp} by not interpolating straight
	* from one color to the other, but instead going through all the hues in between
	* those two colors. The alpha argument can be thought of as the ratio between
	* the two colors, where 0.0 is this color and 1.0 is the first argument.
	*
	* @param {Color} color - The color to converge on.
	* @param {number} alpha - The interpolation factor in the closed interval `[0,1]`.
	* @return {Color} A reference to this color.
	*/
	lerpHSL(color, alpha) {
		this.getHSL(_hslA);
		color.getHSL(_hslB);
		const h = lerp(_hslA.h, _hslB.h, alpha);
		const s = lerp(_hslA.s, _hslB.s, alpha);
		const l = lerp(_hslA.l, _hslB.l, alpha);
		this.setHSL(h, s, l);
		return this;
	}
	/**
	* Sets the color's RGB components from the given 3D vector.
	*
	* @param {Vector3} v - The vector to set.
	* @return {Color} A reference to this color.
	*/
	setFromVector3(v) {
		this.r = v.x;
		this.g = v.y;
		this.b = v.z;
		return this;
	}
	/**
	* Transforms this color with the given 3x3 matrix.
	*
	* @param {Matrix3} m - The matrix.
	* @return {Color} A reference to this color.
	*/
	applyMatrix3(m) {
		const r = this.r, g = this.g, b = this.b;
		const e = m.elements;
		this.r = e[0] * r + e[3] * g + e[6] * b;
		this.g = e[1] * r + e[4] * g + e[7] * b;
		this.b = e[2] * r + e[5] * g + e[8] * b;
		return this;
	}
	/**
	* Returns `true` if this color is equal with the given one.
	*
	* @param {Color} c - The color to test for equality.
	* @return {boolean} Whether this bounding color is equal with the given one.
	*/
	equals(c) {
		return c.r === this.r && c.g === this.g && c.b === this.b;
	}
	/**
	* Sets this color's RGB components from the given array.
	*
	* @param {Array<number>} array - An array holding the RGB values.
	* @param {number} [offset=0] - The offset into the array.
	* @return {Color} A reference to this color.
	*/
	fromArray(array, offset = 0) {
		this.r = array[offset];
		this.g = array[offset + 1];
		this.b = array[offset + 2];
		return this;
	}
	/**
	* Writes the RGB components of this color to the given array. If no array is provided,
	* the method returns a new instance.
	*
	* @param {Array<number>} [array=[]] - The target array holding the color components.
	* @param {number} [offset=0] - Index of the first element in the array.
	* @return {Array<number>} The color components.
	*/
	toArray(array = [], offset = 0) {
		array[offset] = this.r;
		array[offset + 1] = this.g;
		array[offset + 2] = this.b;
		return array;
	}
	/**
	* Sets the components of this color from the given buffer attribute.
	*
	* @param {BufferAttribute} attribute - The buffer attribute holding color data.
	* @param {number} index - The index into the attribute.
	* @return {Color} A reference to this color.
	*/
	fromBufferAttribute(attribute, index) {
		this.r = attribute.getX(index);
		this.g = attribute.getY(index);
		this.b = attribute.getZ(index);
		return this;
	}
	/**
	* This methods defines the serialization result of this class. Returns the color
	* as a hexadecimal value.
	*
	* @return {number} The hexadecimal value.
	*/
	toJSON() {
		return this.getHex();
	}
	*[Symbol.iterator]() {
		yield this.r;
		yield this.g;
		yield this.b;
	}
};
const _color = /*@__PURE__*/ new Color();
/**
* A dictionary with X11 color names.
*
* Note that multiple words such as Dark Orange become the string 'darkorange'.
*
* @static
* @type {Object}
*/
Color.NAMES = _colorKeywords;
const _v0$2 = /*@__PURE__*/ new Vector3();
const _v1$5 = /*@__PURE__*/ new Vector3();
const _v2$4 = /*@__PURE__*/ new Vector3();
const _v3$2 = /*@__PURE__*/ new Vector3();
const _vab = /*@__PURE__*/ new Vector3();
const _vac = /*@__PURE__*/ new Vector3();
const _vbc = /*@__PURE__*/ new Vector3();
const _vap = /*@__PURE__*/ new Vector3();
const _vbp = /*@__PURE__*/ new Vector3();
const _vcp = /*@__PURE__*/ new Vector3();
const _v40 = /*@__PURE__*/ new Vector4();
const _v41 = /*@__PURE__*/ new Vector4();
const _v42 = /*@__PURE__*/ new Vector4();
/**
* A geometric triangle as defined by three vectors representing its three corners.
*/
var Triangle = class Triangle {
	/**
	* Constructs a new triangle.
	*
	* @param {Vector3} [a=(0,0,0)] - The first corner of the triangle.
	* @param {Vector3} [b=(0,0,0)] - The second corner of the triangle.
	* @param {Vector3} [c=(0,0,0)] - The third corner of the triangle.
	*/
	constructor(a = new Vector3(), b = new Vector3(), c = new Vector3()) {
		/**
		* The first corner of the triangle.
		*
		* @type {Vector3}
		*/
		this.a = a;
		/**
		* The second corner of the triangle.
		*
		* @type {Vector3}
		*/
		this.b = b;
		/**
		* The third corner of the triangle.
		*
		* @type {Vector3}
		*/
		this.c = c;
	}
	/**
	* Computes the normal vector of a triangle.
	*
	* @param {Vector3} a - The first corner of the triangle.
	* @param {Vector3} b - The second corner of the triangle.
	* @param {Vector3} c - The third corner of the triangle.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {Vector3} The triangle's normal.
	*/
	static getNormal(a, b, c, target) {
		target.subVectors(c, b);
		_v0$2.subVectors(a, b);
		target.cross(_v0$2);
		const targetLengthSq = target.lengthSq();
		if (targetLengthSq > 0) return target.multiplyScalar(1 / Math.sqrt(targetLengthSq));
		return target.set(0, 0, 0);
	}
	/**
	* Computes a barycentric coordinates from the given vector.
	* Returns `null` if the triangle is degenerate.
	*
	* @param {Vector3} point - A point in 3D space.
	* @param {Vector3} a - The first corner of the triangle.
	* @param {Vector3} b - The second corner of the triangle.
	* @param {Vector3} c - The third corner of the triangle.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {?Vector3} The barycentric coordinates for the given point
	*/
	static getBarycoord(point, a, b, c, target) {
		_v0$2.subVectors(c, a);
		_v1$5.subVectors(b, a);
		_v2$4.subVectors(point, a);
		const dot00 = _v0$2.dot(_v0$2);
		const dot01 = _v0$2.dot(_v1$5);
		const dot02 = _v0$2.dot(_v2$4);
		const dot11 = _v1$5.dot(_v1$5);
		const dot12 = _v1$5.dot(_v2$4);
		const denom = dot00 * dot11 - dot01 * dot01;
		if (denom === 0) {
			target.set(0, 0, 0);
			return null;
		}
		const invDenom = 1 / denom;
		const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
		const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
		return target.set(1 - u - v, v, u);
	}
	/**
	* Returns `true` if the given point, when projected onto the plane of the
	* triangle, lies within the triangle.
	*
	* @param {Vector3} point - The point in 3D space to test.
	* @param {Vector3} a - The first corner of the triangle.
	* @param {Vector3} b - The second corner of the triangle.
	* @param {Vector3} c - The third corner of the triangle.
	* @return {boolean} Whether the given point, when projected onto the plane of the
	* triangle, lies within the triangle or not.
	*/
	static containsPoint(point, a, b, c) {
		if (this.getBarycoord(point, a, b, c, _v3$2) === null) return false;
		return _v3$2.x >= 0 && _v3$2.y >= 0 && _v3$2.x + _v3$2.y <= 1;
	}
	/**
	* Computes the value barycentrically interpolated for the given point on the
	* triangle. Returns `null` if the triangle is degenerate.
	*
	* @param {Vector3} point - Position of interpolated point.
	* @param {Vector3} p1 - The first corner of the triangle.
	* @param {Vector3} p2 - The second corner of the triangle.
	* @param {Vector3} p3 - The third corner of the triangle.
	* @param {Vector3} v1 - Value to interpolate of first vertex.
	* @param {Vector3} v2 - Value to interpolate of second vertex.
	* @param {Vector3} v3 - Value to interpolate of third vertex.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {?Vector3} The interpolated value.
	*/
	static getInterpolation(point, p1, p2, p3, v1, v2, v3, target) {
		if (this.getBarycoord(point, p1, p2, p3, _v3$2) === null) {
			target.x = 0;
			target.y = 0;
			if ("z" in target) target.z = 0;
			if ("w" in target) target.w = 0;
			return null;
		}
		target.setScalar(0);
		target.addScaledVector(v1, _v3$2.x);
		target.addScaledVector(v2, _v3$2.y);
		target.addScaledVector(v3, _v3$2.z);
		return target;
	}
	/**
	* Computes the value barycentrically interpolated for the given attribute and indices.
	*
	* @param {BufferAttribute} attr - The attribute to interpolate.
	* @param {number} i1 - Index of first vertex.
	* @param {number} i2 - Index of second vertex.
	* @param {number} i3 - Index of third vertex.
	* @param {Vector3} barycoord - The barycoordinate value to use to interpolate.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {Vector3} The interpolated attribute value.
	*/
	static getInterpolatedAttribute(attr, i1, i2, i3, barycoord, target) {
		_v40.setScalar(0);
		_v41.setScalar(0);
		_v42.setScalar(0);
		_v40.fromBufferAttribute(attr, i1);
		_v41.fromBufferAttribute(attr, i2);
		_v42.fromBufferAttribute(attr, i3);
		target.setScalar(0);
		target.addScaledVector(_v40, barycoord.x);
		target.addScaledVector(_v41, barycoord.y);
		target.addScaledVector(_v42, barycoord.z);
		return target;
	}
	/**
	* Returns `true` if the triangle is oriented towards the given direction.
	*
	* @param {Vector3} a - The first corner of the triangle.
	* @param {Vector3} b - The second corner of the triangle.
	* @param {Vector3} c - The third corner of the triangle.
	* @param {Vector3} direction - The (normalized) direction vector.
	* @return {boolean} Whether the triangle is oriented towards the given direction or not.
	*/
	static isFrontFacing(a, b, c, direction) {
		_v0$2.subVectors(c, b);
		_v1$5.subVectors(a, b);
		return _v0$2.cross(_v1$5).dot(direction) < 0;
	}
	/**
	* Sets the triangle's vertices by copying the given values.
	*
	* @param {Vector3} a - The first corner of the triangle.
	* @param {Vector3} b - The second corner of the triangle.
	* @param {Vector3} c - The third corner of the triangle.
	* @return {Triangle} A reference to this triangle.
	*/
	set(a, b, c) {
		this.a.copy(a);
		this.b.copy(b);
		this.c.copy(c);
		return this;
	}
	/**
	* Sets the triangle's vertices by copying the given array values.
	*
	* @param {Array<Vector3>} points - An array with 3D points.
	* @param {number} i0 - The array index representing the first corner of the triangle.
	* @param {number} i1 - The array index representing the second corner of the triangle.
	* @param {number} i2 - The array index representing the third corner of the triangle.
	* @return {Triangle} A reference to this triangle.
	*/
	setFromPointsAndIndices(points, i0, i1, i2) {
		this.a.copy(points[i0]);
		this.b.copy(points[i1]);
		this.c.copy(points[i2]);
		return this;
	}
	/**
	* Sets the triangle's vertices by copying the given attribute values.
	*
	* @param {BufferAttribute} attribute - A buffer attribute with 3D points data.
	* @param {number} i0 - The attribute index representing the first corner of the triangle.
	* @param {number} i1 - The attribute index representing the second corner of the triangle.
	* @param {number} i2 - The attribute index representing the third corner of the triangle.
	* @return {Triangle} A reference to this triangle.
	*/
	setFromAttributeAndIndices(attribute, i0, i1, i2) {
		this.a.fromBufferAttribute(attribute, i0);
		this.b.fromBufferAttribute(attribute, i1);
		this.c.fromBufferAttribute(attribute, i2);
		return this;
	}
	/**
	* Returns a new triangle with copied values from this instance.
	*
	* @return {Triangle} A clone of this instance.
	*/
	clone() {
		return new this.constructor().copy(this);
	}
	/**
	* Copies the values of the given triangle to this instance.
	*
	* @param {Triangle} triangle - The triangle to copy.
	* @return {Triangle} A reference to this triangle.
	*/
	copy(triangle) {
		this.a.copy(triangle.a);
		this.b.copy(triangle.b);
		this.c.copy(triangle.c);
		return this;
	}
	/**
	* Computes the area of the triangle.
	*
	* @return {number} The triangle's area.
	*/
	getArea() {
		_v0$2.subVectors(this.c, this.b);
		_v1$5.subVectors(this.a, this.b);
		return _v0$2.cross(_v1$5).length() * .5;
	}
	/**
	* Computes the midpoint of the triangle.
	*
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {Vector3} The triangle's midpoint.
	*/
	getMidpoint(target) {
		return target.addVectors(this.a, this.b).add(this.c).multiplyScalar(1 / 3);
	}
	/**
	* Computes the normal of the triangle.
	*
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {Vector3} The triangle's normal.
	*/
	getNormal(target) {
		return Triangle.getNormal(this.a, this.b, this.c, target);
	}
	/**
	* Computes a plane the triangle lies within.
	*
	* @param {Plane} target - The target vector that is used to store the method's result.
	* @return {Plane} The plane the triangle lies within.
	*/
	getPlane(target) {
		return target.setFromCoplanarPoints(this.a, this.b, this.c);
	}
	/**
	* Computes a barycentric coordinates from the given vector.
	* Returns `null` if the triangle is degenerate.
	*
	* @param {Vector3} point - A point in 3D space.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {?Vector3} The barycentric coordinates for the given point
	*/
	getBarycoord(point, target) {
		return Triangle.getBarycoord(point, this.a, this.b, this.c, target);
	}
	/**
	* Computes the value barycentrically interpolated for the given point on the
	* triangle. Returns `null` if the triangle is degenerate.
	*
	* @param {Vector3} point - Position of interpolated point.
	* @param {Vector3} v1 - Value to interpolate of first vertex.
	* @param {Vector3} v2 - Value to interpolate of second vertex.
	* @param {Vector3} v3 - Value to interpolate of third vertex.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {?Vector3} The interpolated value.
	*/
	getInterpolation(point, v1, v2, v3, target) {
		return Triangle.getInterpolation(point, this.a, this.b, this.c, v1, v2, v3, target);
	}
	/**
	* Returns `true` if the given point, when projected onto the plane of the
	* triangle, lies within the triangle.
	*
	* @param {Vector3} point - The point in 3D space to test.
	* @return {boolean} Whether the given point, when projected onto the plane of the
	* triangle, lies within the triangle or not.
	*/
	containsPoint(point) {
		return Triangle.containsPoint(point, this.a, this.b, this.c);
	}
	/**
	* Returns `true` if the triangle is oriented towards the given direction.
	*
	* @param {Vector3} direction - The (normalized) direction vector.
	* @return {boolean} Whether the triangle is oriented towards the given direction or not.
	*/
	isFrontFacing(direction) {
		return Triangle.isFrontFacing(this.a, this.b, this.c, direction);
	}
	/**
	* Returns `true` if this triangle intersects with the given box.
	*
	* @param {Box3} box - The box to intersect.
	* @return {boolean} Whether this triangle intersects with the given box or not.
	*/
	intersectsBox(box) {
		return box.intersectsTriangle(this);
	}
	/**
	* Returns the closest point on the triangle to the given point.
	*
	* @param {Vector3} p - The point to compute the closest point for.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {Vector3} The closest point on the triangle.
	*/
	closestPointToPoint(p, target) {
		const a = this.a, b = this.b, c = this.c;
		let v, w;
		_vab.subVectors(b, a);
		_vac.subVectors(c, a);
		_vap.subVectors(p, a);
		const d1 = _vab.dot(_vap);
		const d2 = _vac.dot(_vap);
		if (d1 <= 0 && d2 <= 0) return target.copy(a);
		_vbp.subVectors(p, b);
		const d3 = _vab.dot(_vbp);
		const d4 = _vac.dot(_vbp);
		if (d3 >= 0 && d4 <= d3) return target.copy(b);
		const vc = d1 * d4 - d3 * d2;
		if (vc <= 0 && d1 >= 0 && d3 <= 0) {
			v = d1 / (d1 - d3);
			return target.copy(a).addScaledVector(_vab, v);
		}
		_vcp.subVectors(p, c);
		const d5 = _vab.dot(_vcp);
		const d6 = _vac.dot(_vcp);
		if (d6 >= 0 && d5 <= d6) return target.copy(c);
		const vb = d5 * d2 - d1 * d6;
		if (vb <= 0 && d2 >= 0 && d6 <= 0) {
			w = d2 / (d2 - d6);
			return target.copy(a).addScaledVector(_vac, w);
		}
		const va = d3 * d6 - d5 * d4;
		if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
			_vbc.subVectors(c, b);
			w = (d4 - d3) / (d4 - d3 + (d5 - d6));
			return target.copy(b).addScaledVector(_vbc, w);
		}
		const denom = 1 / (va + vb + vc);
		v = vb * denom;
		w = vc * denom;
		return target.copy(a).addScaledVector(_vab, v).addScaledVector(_vac, w);
	}
	/**
	* Returns `true` if this triangle is equal with the given one.
	*
	* @param {Triangle} triangle - The triangle to test for equality.
	* @return {boolean} Whether this triangle is equal with the given one.
	*/
	equals(triangle) {
		return triangle.a.equals(this.a) && triangle.b.equals(this.b) && triangle.c.equals(this.c);
	}
};
/**
* Represents an axis-aligned bounding box (AABB) in 3D space.
*/
var Box3 = class {
	/**
	* Constructs a new bounding box.
	*
	* @param {Vector3} [min=(Infinity,Infinity,Infinity)] - A vector representing the lower boundary of the box.
	* @param {Vector3} [max=(-Infinity,-Infinity,-Infinity)] - A vector representing the upper boundary of the box.
	*/
	constructor(min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isBox3 = true;
		/**
		* The lower boundary of the box.
		*
		* @type {Vector3}
		*/
		this.min = min;
		/**
		* The upper boundary of the box.
		*
		* @type {Vector3}
		*/
		this.max = max;
	}
	/**
	* Sets the lower and upper boundaries of this box.
	* Please note that this method only copies the values from the given objects.
	*
	* @param {Vector3} min - The lower boundary of the box.
	* @param {Vector3} max - The upper boundary of the box.
	* @return {Box3} A reference to this bounding box.
	*/
	set(min, max) {
		this.min.copy(min);
		this.max.copy(max);
		return this;
	}
	/**
	* Sets the upper and lower bounds of this box so it encloses the position data
	* in the given array.
	*
	* @param {Array<number>} array - An array holding 3D position data.
	* @return {Box3} A reference to this bounding box.
	*/
	setFromArray(array) {
		this.makeEmpty();
		for (let i = 0, il = array.length; i < il; i += 3) this.expandByPoint(_vector$b.fromArray(array, i));
		return this;
	}
	/**
	* Sets the upper and lower bounds of this box so it encloses the position data
	* in the given buffer attribute.
	*
	* @param {BufferAttribute} attribute - A buffer attribute holding 3D position data.
	* @return {Box3} A reference to this bounding box.
	*/
	setFromBufferAttribute(attribute) {
		this.makeEmpty();
		for (let i = 0, il = attribute.count; i < il; i++) this.expandByPoint(_vector$b.fromBufferAttribute(attribute, i));
		return this;
	}
	/**
	* Sets the upper and lower bounds of this box so it encloses the position data
	* in the given array.
	*
	* @param {Array<Vector3>} points - An array holding 3D position data as instances of {@link Vector3}.
	* @return {Box3} A reference to this bounding box.
	*/
	setFromPoints(points) {
		this.makeEmpty();
		for (let i = 0, il = points.length; i < il; i++) this.expandByPoint(points[i]);
		return this;
	}
	/**
	* Centers this box on the given center vector and sets this box's width, height and
	* depth to the given size values.
	*
	* @param {Vector3} center - The center of the box.
	* @param {Vector3} size - The x, y and z dimensions of the box.
	* @return {Box3} A reference to this bounding box.
	*/
	setFromCenterAndSize(center, size) {
		const halfSize = _vector$b.copy(size).multiplyScalar(.5);
		this.min.copy(center).sub(halfSize);
		this.max.copy(center).add(halfSize);
		return this;
	}
	/**
	* Computes the world-axis-aligned bounding box for the given 3D object
	* (including its children), accounting for the object's, and children's,
	* world transforms. The function may result in a larger box than strictly necessary.
	*
	* Note: To compute the correct bounding box, make sure the given 3D object
	* has an up-to-date world matrix that reflects the current transformation of its
	* ancestor nodes. Call `object.updateWorldMatrix( true, false )` beforehand if
	* you're unsure.
	*
	* @param {Object3D} object - The 3D object to compute the bounding box for.
	* @param {boolean} [precise=false] - If set to `true`, the method computes the smallest
	* world-axis-aligned bounding box at the expense of more computation.
	* @return {Box3} A reference to this bounding box.
	*/
	setFromObject(object, precise = false) {
		this.makeEmpty();
		return this.expandByObject(object, precise);
	}
	/**
	* Returns a new box with copied values from this instance.
	*
	* @return {Box3} A clone of this instance.
	*/
	clone() {
		return new this.constructor().copy(this);
	}
	/**
	* Copies the values of the given box to this instance.
	*
	* @param {Box3} box - The box to copy.
	* @return {Box3} A reference to this bounding box.
	*/
	copy(box) {
		this.min.copy(box.min);
		this.max.copy(box.max);
		return this;
	}
	/**
	* Makes this box empty which means in encloses a zero space in 3D.
	*
	* @return {Box3} A reference to this bounding box.
	*/
	makeEmpty() {
		this.min.x = this.min.y = this.min.z = Infinity;
		this.max.x = this.max.y = this.max.z = -Infinity;
		return this;
	}
	/**
	* Returns true if this box includes zero points within its bounds.
	* Note that a box with equal lower and upper bounds still includes one
	* point, the one both bounds share.
	*
	* @return {boolean} Whether this box is empty or not.
	*/
	isEmpty() {
		return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
	}
	/**
	* Returns the center point of this box.
	*
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {Vector3} The center point.
	*/
	getCenter(target) {
		return this.isEmpty() ? target.set(0, 0, 0) : target.addVectors(this.min, this.max).multiplyScalar(.5);
	}
	/**
	* Returns the dimensions of this box.
	*
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {Vector3} The size.
	*/
	getSize(target) {
		return this.isEmpty() ? target.set(0, 0, 0) : target.subVectors(this.max, this.min);
	}
	/**
	* Expands the boundaries of this box to include the given point.
	*
	* @param {Vector3} point - The point that should be included by the bounding box.
	* @return {Box3} A reference to this bounding box.
	*/
	expandByPoint(point) {
		this.min.min(point);
		this.max.max(point);
		return this;
	}
	/**
	* Expands this box equilaterally by the given vector. The width of this
	* box will be expanded by the x component of the vector in both
	* directions. The height of this box will be expanded by the y component of
	* the vector in both directions. The depth of this box will be
	* expanded by the z component of the vector in both directions.
	*
	* @param {Vector3} vector - The vector that should expand the bounding box.
	* @return {Box3} A reference to this bounding box.
	*/
	expandByVector(vector) {
		this.min.sub(vector);
		this.max.add(vector);
		return this;
	}
	/**
	* Expands each dimension of the box by the given scalar. If negative, the
	* dimensions of the box will be contracted.
	*
	* @param {number} scalar - The scalar value that should expand the bounding box.
	* @return {Box3} A reference to this bounding box.
	*/
	expandByScalar(scalar) {
		this.min.addScalar(-scalar);
		this.max.addScalar(scalar);
		return this;
	}
	/**
	* Expands the boundaries of this box to include the given 3D object and
	* its children, accounting for the object's, and children's, world
	* transforms. The function may result in a larger box than strictly
	* necessary (unless the precise parameter is set to true).
	*
	* @param {Object3D} object - The 3D object that should expand the bounding box.
	* @param {boolean} precise - If set to `true`, the method expands the bounding box
	* as little as necessary at the expense of more computation.
	* @return {Box3} A reference to this bounding box.
	*/
	expandByObject(object, precise = false) {
		object.updateWorldMatrix(false, false);
		const geometry = object.geometry;
		if (geometry !== void 0) {
			const positionAttribute = geometry.getAttribute("position");
			if (precise === true && positionAttribute !== void 0 && object.isInstancedMesh !== true) for (let i = 0, l = positionAttribute.count; i < l; i++) {
				if (object.isMesh === true) object.getVertexPosition(i, _vector$b);
				else _vector$b.fromBufferAttribute(positionAttribute, i);
				_vector$b.applyMatrix4(object.matrixWorld);
				this.expandByPoint(_vector$b);
			}
			else {
				if (object.boundingBox !== void 0) {
					if (object.boundingBox === null) object.computeBoundingBox();
					_box$4.copy(object.boundingBox);
				} else {
					if (geometry.boundingBox === null) geometry.computeBoundingBox();
					_box$4.copy(geometry.boundingBox);
				}
				_box$4.applyMatrix4(object.matrixWorld);
				this.union(_box$4);
			}
		}
		const children = object.children;
		for (let i = 0, l = children.length; i < l; i++) this.expandByObject(children[i], precise);
		return this;
	}
	/**
	* Returns `true` if the given point lies within or on the boundaries of this box.
	*
	* @param {Vector3} point - The point to test.
	* @return {boolean} Whether the bounding box contains the given point or not.
	*/
	containsPoint(point) {
		return point.x >= this.min.x && point.x <= this.max.x && point.y >= this.min.y && point.y <= this.max.y && point.z >= this.min.z && point.z <= this.max.z;
	}
	/**
	* Returns `true` if this bounding box includes the entirety of the given bounding box.
	* If this box and the given one are identical, this function also returns `true`.
	*
	* @param {Box3} box - The bounding box to test.
	* @return {boolean} Whether the bounding box contains the given bounding box or not.
	*/
	containsBox(box) {
		return this.min.x <= box.min.x && box.max.x <= this.max.x && this.min.y <= box.min.y && box.max.y <= this.max.y && this.min.z <= box.min.z && box.max.z <= this.max.z;
	}
	/**
	* Returns a point as a proportion of this box's width, height and depth.
	*
	* @param {Vector3} point - A point in 3D space.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {Vector3} A point as a proportion of this box's width, height and depth.
	*/
	getParameter(point, target) {
		return target.set((point.x - this.min.x) / (this.max.x - this.min.x), (point.y - this.min.y) / (this.max.y - this.min.y), (point.z - this.min.z) / (this.max.z - this.min.z));
	}
	/**
	* Returns `true` if the given bounding box intersects with this bounding box.
	*
	* @param {Box3} box - The bounding box to test.
	* @return {boolean} Whether the given bounding box intersects with this bounding box.
	*/
	intersectsBox(box) {
		return box.max.x >= this.min.x && box.min.x <= this.max.x && box.max.y >= this.min.y && box.min.y <= this.max.y && box.max.z >= this.min.z && box.min.z <= this.max.z;
	}
	/**
	* Returns `true` if the given bounding sphere intersects with this bounding box.
	*
	* @param {Sphere} sphere - The bounding sphere to test.
	* @return {boolean} Whether the given bounding sphere intersects with this bounding box.
	*/
	intersectsSphere(sphere) {
		this.clampPoint(sphere.center, _vector$b);
		return _vector$b.distanceToSquared(sphere.center) <= sphere.radius * sphere.radius;
	}
	/**
	* Returns `true` if the given plane intersects with this bounding box.
	*
	* @param {Plane} plane - The plane to test.
	* @return {boolean} Whether the given plane intersects with this bounding box.
	*/
	intersectsPlane(plane) {
		let min, max;
		if (plane.normal.x > 0) {
			min = plane.normal.x * this.min.x;
			max = plane.normal.x * this.max.x;
		} else {
			min = plane.normal.x * this.max.x;
			max = plane.normal.x * this.min.x;
		}
		if (plane.normal.y > 0) {
			min += plane.normal.y * this.min.y;
			max += plane.normal.y * this.max.y;
		} else {
			min += plane.normal.y * this.max.y;
			max += plane.normal.y * this.min.y;
		}
		if (plane.normal.z > 0) {
			min += plane.normal.z * this.min.z;
			max += plane.normal.z * this.max.z;
		} else {
			min += plane.normal.z * this.max.z;
			max += plane.normal.z * this.min.z;
		}
		return min <= -plane.constant && max >= -plane.constant;
	}
	/**
	* Returns `true` if the given triangle intersects with this bounding box.
	*
	* @param {Triangle} triangle - The triangle to test.
	* @return {boolean} Whether the given triangle intersects with this bounding box.
	*/
	intersectsTriangle(triangle) {
		if (this.isEmpty()) return false;
		this.getCenter(_center);
		_extents.subVectors(this.max, _center);
		_v0$1.subVectors(triangle.a, _center);
		_v1$4.subVectors(triangle.b, _center);
		_v2$3.subVectors(triangle.c, _center);
		_f0.subVectors(_v1$4, _v0$1);
		_f1.subVectors(_v2$3, _v1$4);
		_f2.subVectors(_v0$1, _v2$3);
		let axes = [
			0,
			-_f0.z,
			_f0.y,
			0,
			-_f1.z,
			_f1.y,
			0,
			-_f2.z,
			_f2.y,
			_f0.z,
			0,
			-_f0.x,
			_f1.z,
			0,
			-_f1.x,
			_f2.z,
			0,
			-_f2.x,
			-_f0.y,
			_f0.x,
			0,
			-_f1.y,
			_f1.x,
			0,
			-_f2.y,
			_f2.x,
			0
		];
		if (!satForAxes(axes, _v0$1, _v1$4, _v2$3, _extents)) return false;
		axes = [
			1,
			0,
			0,
			0,
			1,
			0,
			0,
			0,
			1
		];
		if (!satForAxes(axes, _v0$1, _v1$4, _v2$3, _extents)) return false;
		_triangleNormal.crossVectors(_f0, _f1);
		axes = [
			_triangleNormal.x,
			_triangleNormal.y,
			_triangleNormal.z
		];
		return satForAxes(axes, _v0$1, _v1$4, _v2$3, _extents);
	}
	/**
	* Clamps the given point within the bounds of this box.
	*
	* @param {Vector3} point - The point to clamp.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {Vector3} The clamped point.
	*/
	clampPoint(point, target) {
		return target.copy(point).clamp(this.min, this.max);
	}
	/**
	* Returns the euclidean distance from any edge of this box to the specified point. If
	* the given point lies inside of this box, the distance will be `0`.
	*
	* @param {Vector3} point - The point to compute the distance to.
	* @return {number} The euclidean distance.
	*/
	distanceToPoint(point) {
		return this.clampPoint(point, _vector$b).distanceTo(point);
	}
	/**
	* Returns a bounding sphere that encloses this bounding box.
	*
	* @param {Sphere} target - The target sphere that is used to store the method's result.
	* @return {Sphere} The bounding sphere that encloses this bounding box.
	*/
	getBoundingSphere(target) {
		if (this.isEmpty()) target.makeEmpty();
		else {
			this.getCenter(target.center);
			target.radius = this.getSize(_vector$b).length() * .5;
		}
		return target;
	}
	/**
	* Computes the intersection of this bounding box and the given one, setting the upper
	* bound of this box to the lesser of the two boxes' upper bounds and the
	* lower bound of this box to the greater of the two boxes' lower bounds. If
	* there's no overlap, makes this box empty.
	*
	* @param {Box3} box - The bounding box to intersect with.
	* @return {Box3} A reference to this bounding box.
	*/
	intersect(box) {
		this.min.max(box.min);
		this.max.min(box.max);
		if (this.isEmpty()) this.makeEmpty();
		return this;
	}
	/**
	* Computes the union of this box and another and the given one, setting the upper
	* bound of this box to the greater of the two boxes' upper bounds and the
	* lower bound of this box to the lesser of the two boxes' lower bounds.
	*
	* @param {Box3} box - The bounding box that will be unioned with this instance.
	* @return {Box3} A reference to this bounding box.
	*/
	union(box) {
		this.min.min(box.min);
		this.max.max(box.max);
		return this;
	}
	/**
	* Transforms this bounding box by the given 4x4 transformation matrix.
	*
	* @param {Matrix4} matrix - The transformation matrix.
	* @return {Box3} A reference to this bounding box.
	*/
	applyMatrix4(matrix) {
		if (this.isEmpty()) return this;
		_points[0].set(this.min.x, this.min.y, this.min.z).applyMatrix4(matrix);
		_points[1].set(this.min.x, this.min.y, this.max.z).applyMatrix4(matrix);
		_points[2].set(this.min.x, this.max.y, this.min.z).applyMatrix4(matrix);
		_points[3].set(this.min.x, this.max.y, this.max.z).applyMatrix4(matrix);
		_points[4].set(this.max.x, this.min.y, this.min.z).applyMatrix4(matrix);
		_points[5].set(this.max.x, this.min.y, this.max.z).applyMatrix4(matrix);
		_points[6].set(this.max.x, this.max.y, this.min.z).applyMatrix4(matrix);
		_points[7].set(this.max.x, this.max.y, this.max.z).applyMatrix4(matrix);
		this.setFromPoints(_points);
		return this;
	}
	/**
	* Adds the given offset to both the upper and lower bounds of this bounding box,
	* effectively moving it in 3D space.
	*
	* @param {Vector3} offset - The offset that should be used to translate the bounding box.
	* @return {Box3} A reference to this bounding box.
	*/
	translate(offset) {
		this.min.add(offset);
		this.max.add(offset);
		return this;
	}
	/**
	* Returns `true` if this bounding box is equal with the given one.
	*
	* @param {Box3} box - The box to test for equality.
	* @return {boolean} Whether this bounding box is equal with the given one.
	*/
	equals(box) {
		return box.min.equals(this.min) && box.max.equals(this.max);
	}
	/**
	* Returns a serialized structure of the bounding box.
	*
	* @return {Object} Serialized structure with fields representing the object state.
	*/
	toJSON() {
		return {
			min: this.min.toArray(),
			max: this.max.toArray()
		};
	}
	/**
	* Returns a serialized structure of the bounding box.
	*
	* @param {Object} json - The serialized json to set the box from.
	* @return {Box3} A reference to this bounding box.
	*/
	fromJSON(json) {
		this.min.fromArray(json.min);
		this.max.fromArray(json.max);
		return this;
	}
};
const _points = [
	/*@__PURE__*/ new Vector3(),
	/*@__PURE__*/ new Vector3(),
	/*@__PURE__*/ new Vector3(),
	/*@__PURE__*/ new Vector3(),
	/*@__PURE__*/ new Vector3(),
	/*@__PURE__*/ new Vector3(),
	/*@__PURE__*/ new Vector3(),
	/*@__PURE__*/ new Vector3()
];
const _vector$b = /*@__PURE__*/ new Vector3();
const _box$4 = /*@__PURE__*/ new Box3();
const _v0$1 = /*@__PURE__*/ new Vector3();
const _v1$4 = /*@__PURE__*/ new Vector3();
const _v2$3 = /*@__PURE__*/ new Vector3();
const _f0 = /*@__PURE__*/ new Vector3();
const _f1 = /*@__PURE__*/ new Vector3();
const _f2 = /*@__PURE__*/ new Vector3();
const _center = /*@__PURE__*/ new Vector3();
const _extents = /*@__PURE__*/ new Vector3();
const _triangleNormal = /*@__PURE__*/ new Vector3();
const _testAxis = /*@__PURE__*/ new Vector3();
function satForAxes(axes, v0, v1, v2, extents) {
	for (let i = 0, j = axes.length - 3; i <= j; i += 3) {
		_testAxis.fromArray(axes, i);
		const r = extents.x * Math.abs(_testAxis.x) + extents.y * Math.abs(_testAxis.y) + extents.z * Math.abs(_testAxis.z);
		const p0 = v0.dot(_testAxis);
		const p1 = v1.dot(_testAxis);
		const p2 = v2.dot(_testAxis);
		if (Math.max(-Math.max(p0, p1, p2), Math.min(p0, p1, p2)) > r) return false;
	}
	return true;
}
const _vector$a = /*@__PURE__*/ new Vector3();
const _vector2$1 = /*@__PURE__*/ new Vector2();
let _id$2 = 0;
/**
* This class stores data for an attribute (such as vertex positions, face
* indices, normals, colors, UVs, and any custom attributes ) associated with
* a geometry, which allows for more efficient passing of data to the GPU.
*
* When working with vector-like data, the `fromBufferAttribute( attribute, index )`
* helper methods on vector and color class might be helpful. E.g. {@link Vector3#fromBufferAttribute}.
*/
var BufferAttribute = class extends EventDispatcher {
	/**
	* Constructs a new buffer attribute.
	*
	* @param {TypedArray} array - The array holding the attribute data.
	* @param {number} itemSize - The item size.
	* @param {boolean} [normalized=false] - Whether the data are normalized or not.
	*/
	constructor(array, itemSize, normalized = false) {
		super();
		if (Array.isArray(array)) throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isBufferAttribute = true;
		/**
		* The ID of the buffer attribute.
		*
		* @name BufferAttribute#id
		* @type {number}
		* @readonly
		*/
		Object.defineProperty(this, "id", { value: _id$2++ });
		/**
		* The name of the buffer attribute.
		*
		* @type {string}
		*/
		this.name = "";
		/**
		* The array holding the attribute data. It should have `itemSize * numVertices`
		* elements, where `numVertices` is the number of vertices in the associated geometry.
		*
		* @type {TypedArray}
		*/
		this.array = array;
		/**
		* The number of values of the array that should be associated with a particular vertex.
		* For instance, if this attribute is storing a 3-component vector (such as a position,
		* normal, or color), then the value should be `3`.
		*
		* @type {number}
		*/
		this.itemSize = itemSize;
		/**
		* Represents the number of items this buffer attribute stores. It is internally computed
		* by dividing the `array` length by the `itemSize`.
		*
		* @type {number}
		* @readonly
		*/
		this.count = array !== void 0 ? array.length / itemSize : 0;
		/**
		* Applies to integer data only. Indicates how the underlying data in the buffer maps to
		* the values in the GLSL code. For instance, if `array` is an instance of `UInt16Array`,
		* and `normalized` is `true`, the values `0 - +65535` in the array data will be mapped to
		* `0.0f - +1.0f` in the GLSL attribute. If `normalized` is `false`, the values will be converted
		* to floats unmodified, i.e. `65535` becomes `65535.0f`.
		*
		* @type {boolean}
		*/
		this.normalized = normalized;
		/**
		* Defines the intended usage pattern of the data store for optimization purposes.
		*
		* Note: After the initial use of a buffer, its usage cannot be changed. Instead,
		* instantiate a new one and set the desired usage before the next render.
		*
		* @type {(StaticDrawUsage|DynamicDrawUsage|StreamDrawUsage|StaticReadUsage|DynamicReadUsage|StreamReadUsage|StaticCopyUsage|DynamicCopyUsage|StreamCopyUsage)}
		* @default StaticDrawUsage
		*/
		this.usage = StaticDrawUsage;
		/**
		* This can be used to only update some components of stored vectors (for example, just the
		* component related to color). Use the `addUpdateRange()` function to add ranges to this array.
		*
		* @type {Array<Object>}
		*/
		this.updateRanges = [];
		/**
		* Configures the bound GPU type for use in shaders.
		*
		* Note: this only has an effect for integer arrays and is not configurable for float arrays.
		* For lower precision float types, use `Float16BufferAttribute`.
		*
		* @type {(FloatType|IntType)}
		* @default FloatType
		*/
		this.gpuType = FloatType;
		/**
		* A version number, incremented every time the `needsUpdate` is set to `true`.
		*
		* @type {number}
		*/
		this.version = 0;
	}
	/**
	* A callback function that is executed after the renderer has transferred the attribute
	* array data to the GPU.
	*/
	onUploadCallback() {}
	/**
	* Flag to indicate that this attribute has changed and should be re-sent to
	* the GPU. Set this to `true` when you modify the value of the array.
	*
	* @type {number}
	* @default false
	* @param {boolean} value
	*/
	set needsUpdate(value) {
		if (value === true) this.version++;
	}
	/**
	* Sets the usage of this buffer attribute.
	*
	* @param {(StaticDrawUsage|DynamicDrawUsage|StreamDrawUsage|StaticReadUsage|DynamicReadUsage|StreamReadUsage|StaticCopyUsage|DynamicCopyUsage|StreamCopyUsage)} value - The usage to set.
	* @return {BufferAttribute} A reference to this buffer attribute.
	*/
	setUsage(value) {
		this.usage = value;
		return this;
	}
	/**
	* Adds a range of data in the data array to be updated on the GPU.
	*
	* @param {number} start - Position at which to start update.
	* @param {number} count - The number of components to update.
	*/
	addUpdateRange(start, count) {
		this.updateRanges.push({
			start,
			count
		});
	}
	/**
	* Clears the update ranges.
	*/
	clearUpdateRanges() {
		this.updateRanges.length = 0;
	}
	/**
	* Copies the values of the given buffer attribute to this instance.
	*
	* @param {BufferAttribute} source - The buffer attribute to copy.
	* @return {BufferAttribute} A reference to this instance.
	*/
	copy(source) {
		this.name = source.name;
		this.array = new source.array.constructor(source.array);
		this.itemSize = source.itemSize;
		this.count = source.count;
		this.normalized = source.normalized;
		this.usage = source.usage;
		this.gpuType = source.gpuType;
		return this;
	}
	/**
	* Copies a vector from the given buffer attribute to this one. The start
	* and destination position in the attribute buffers are represented by the
	* given indices.
	*
	* @param {number} index1 - The destination index into this buffer attribute.
	* @param {BufferAttribute} attribute - The buffer attribute to copy from.
	* @param {number} index2 - The source index into the given buffer attribute.
	* @return {BufferAttribute} A reference to this instance.
	*/
	copyAt(index1, attribute, index2) {
		index1 *= this.itemSize;
		index2 *= attribute.itemSize;
		for (let i = 0, l = this.itemSize; i < l; i++) this.array[index1 + i] = attribute.array[index2 + i];
		return this;
	}
	/**
	* Copies the given array data into this buffer attribute.
	*
	* @param {(TypedArray|Array)} array - The array to copy.
	* @return {BufferAttribute} A reference to this instance.
	*/
	copyArray(array) {
		this.array.set(array);
		return this;
	}
	/**
	* Applies the given 3x3 matrix to the given attribute. Works with
	* item size `2` and `3`.
	*
	* @param {Matrix3} m - The matrix to apply.
	* @return {BufferAttribute} A reference to this instance.
	*/
	applyMatrix3(m) {
		if (this.itemSize === 2) for (let i = 0, l = this.count; i < l; i++) {
			_vector2$1.fromBufferAttribute(this, i);
			_vector2$1.applyMatrix3(m);
			this.setXY(i, _vector2$1.x, _vector2$1.y);
		}
		else if (this.itemSize === 3) for (let i = 0, l = this.count; i < l; i++) {
			_vector$a.fromBufferAttribute(this, i);
			_vector$a.applyMatrix3(m);
			this.setXYZ(i, _vector$a.x, _vector$a.y, _vector$a.z);
		}
		return this;
	}
	/**
	* Applies the given 4x4 matrix to the given attribute. Only works with
	* item size `3`.
	*
	* @param {Matrix4} m - The matrix to apply.
	* @return {BufferAttribute} A reference to this instance.
	*/
	applyMatrix4(m) {
		for (let i = 0, l = this.count; i < l; i++) {
			_vector$a.fromBufferAttribute(this, i);
			_vector$a.applyMatrix4(m);
			this.setXYZ(i, _vector$a.x, _vector$a.y, _vector$a.z);
		}
		return this;
	}
	/**
	* Applies the given 3x3 normal matrix to the given attribute. Only works with
	* item size `3`.
	*
	* @param {Matrix3} m - The normal matrix to apply.
	* @return {BufferAttribute} A reference to this instance.
	*/
	applyNormalMatrix(m) {
		for (let i = 0, l = this.count; i < l; i++) {
			_vector$a.fromBufferAttribute(this, i);
			_vector$a.applyNormalMatrix(m);
			this.setXYZ(i, _vector$a.x, _vector$a.y, _vector$a.z);
		}
		return this;
	}
	/**
	* Applies the given 4x4 matrix to the given attribute. Only works with
	* item size `3` and with direction vectors.
	*
	* @param {Matrix4} m - The matrix to apply.
	* @return {BufferAttribute} A reference to this instance.
	*/
	transformDirection(m) {
		for (let i = 0, l = this.count; i < l; i++) {
			_vector$a.fromBufferAttribute(this, i);
			_vector$a.transformDirection(m);
			this.setXYZ(i, _vector$a.x, _vector$a.y, _vector$a.z);
		}
		return this;
	}
	/**
	* Sets the given array data in the buffer attribute.
	*
	* @param {(TypedArray|Array)} value - The array data to set.
	* @param {number} [offset=0] - The offset in this buffer attribute's array.
	* @return {BufferAttribute} A reference to this instance.
	*/
	set(value, offset = 0) {
		this.array.set(value, offset);
		return this;
	}
	/**
	* Returns the given component of the vector at the given index.
	*
	* @param {number} index - The index into the buffer attribute.
	* @param {number} component - The component index.
	* @return {number} The returned value.
	*/
	getComponent(index, component) {
		let value = this.array[index * this.itemSize + component];
		if (this.normalized) value = denormalize(value, this.array);
		return value;
	}
	/**
	* Sets the given value to the given component of the vector at the given index.
	*
	* @param {number} index - The index into the buffer attribute.
	* @param {number} component - The component index.
	* @param {number} value - The value to set.
	* @return {BufferAttribute} A reference to this instance.
	*/
	setComponent(index, component, value) {
		if (this.normalized) value = normalize(value, this.array);
		this.array[index * this.itemSize + component] = value;
		return this;
	}
	/**
	* Returns the x component of the vector at the given index.
	*
	* @param {number} index - The index into the buffer attribute.
	* @return {number} The x component.
	*/
	getX(index) {
		let x = this.array[index * this.itemSize];
		if (this.normalized) x = denormalize(x, this.array);
		return x;
	}
	/**
	* Sets the x component of the vector at the given index.
	*
	* @param {number} index - The index into the buffer attribute.
	* @param {number} x - The value to set.
	* @return {BufferAttribute} A reference to this instance.
	*/
	setX(index, x) {
		if (this.normalized) x = normalize(x, this.array);
		this.array[index * this.itemSize] = x;
		return this;
	}
	/**
	* Returns the y component of the vector at the given index.
	*
	* @param {number} index - The index into the buffer attribute.
	* @return {number} The y component.
	*/
	getY(index) {
		let y = this.array[index * this.itemSize + 1];
		if (this.normalized) y = denormalize(y, this.array);
		return y;
	}
	/**
	* Sets the y component of the vector at the given index.
	*
	* @param {number} index - The index into the buffer attribute.
	* @param {number} y - The value to set.
	* @return {BufferAttribute} A reference to this instance.
	*/
	setY(index, y) {
		if (this.normalized) y = normalize(y, this.array);
		this.array[index * this.itemSize + 1] = y;
		return this;
	}
	/**
	* Returns the z component of the vector at the given index.
	*
	* @param {number} index - The index into the buffer attribute.
	* @return {number} The z component.
	*/
	getZ(index) {
		let z = this.array[index * this.itemSize + 2];
		if (this.normalized) z = denormalize(z, this.array);
		return z;
	}
	/**
	* Sets the z component of the vector at the given index.
	*
	* @param {number} index - The index into the buffer attribute.
	* @param {number} z - The value to set.
	* @return {BufferAttribute} A reference to this instance.
	*/
	setZ(index, z) {
		if (this.normalized) z = normalize(z, this.array);
		this.array[index * this.itemSize + 2] = z;
		return this;
	}
	/**
	* Returns the w component of the vector at the given index.
	*
	* @param {number} index - The index into the buffer attribute.
	* @return {number} The w component.
	*/
	getW(index) {
		let w = this.array[index * this.itemSize + 3];
		if (this.normalized) w = denormalize(w, this.array);
		return w;
	}
	/**
	* Sets the w component of the vector at the given index.
	*
	* @param {number} index - The index into the buffer attribute.
	* @param {number} w - The value to set.
	* @return {BufferAttribute} A reference to this instance.
	*/
	setW(index, w) {
		if (this.normalized) w = normalize(w, this.array);
		this.array[index * this.itemSize + 3] = w;
		return this;
	}
	/**
	* Sets the x and y component of the vector at the given index.
	*
	* @param {number} index - The index into the buffer attribute.
	* @param {number} x - The value for the x component to set.
	* @param {number} y - The value for the y component to set.
	* @return {BufferAttribute} A reference to this instance.
	*/
	setXY(index, x, y) {
		index *= this.itemSize;
		if (this.normalized) {
			x = normalize(x, this.array);
			y = normalize(y, this.array);
		}
		this.array[index + 0] = x;
		this.array[index + 1] = y;
		return this;
	}
	/**
	* Sets the x, y and z component of the vector at the given index.
	*
	* @param {number} index - The index into the buffer attribute.
	* @param {number} x - The value for the x component to set.
	* @param {number} y - The value for the y component to set.
	* @param {number} z - The value for the z component to set.
	* @return {BufferAttribute} A reference to this instance.
	*/
	setXYZ(index, x, y, z) {
		index *= this.itemSize;
		if (this.normalized) {
			x = normalize(x, this.array);
			y = normalize(y, this.array);
			z = normalize(z, this.array);
		}
		this.array[index + 0] = x;
		this.array[index + 1] = y;
		this.array[index + 2] = z;
		return this;
	}
	/**
	* Sets the x, y, z and w component of the vector at the given index.
	*
	* @param {number} index - The index into the buffer attribute.
	* @param {number} x - The value for the x component to set.
	* @param {number} y - The value for the y component to set.
	* @param {number} z - The value for the z component to set.
	* @param {number} w - The value for the w component to set.
	* @return {BufferAttribute} A reference to this instance.
	*/
	setXYZW(index, x, y, z, w) {
		index *= this.itemSize;
		if (this.normalized) {
			x = normalize(x, this.array);
			y = normalize(y, this.array);
			z = normalize(z, this.array);
			w = normalize(w, this.array);
		}
		this.array[index + 0] = x;
		this.array[index + 1] = y;
		this.array[index + 2] = z;
		this.array[index + 3] = w;
		return this;
	}
	/**
	* Sets the given callback function that is executed after the Renderer has transferred
	* the attribute array data to the GPU. Can be used to perform clean-up operations after
	* the upload when attribute data are not needed anymore on the CPU side.
	*
	* @param {Function} callback - The `onUpload()` callback.
	* @return {BufferAttribute} A reference to this instance.
	*/
	onUpload(callback) {
		this.onUploadCallback = callback;
		return this;
	}
	/**
	* Returns a new buffer attribute with copied values from this instance.
	*
	* @return {BufferAttribute} A clone of this instance.
	*/
	clone() {
		return new this.constructor(this.array, this.itemSize).copy(this);
	}
	/**
	* Serializes the buffer attribute into JSON.
	*
	* @return {Object} A JSON object representing the serialized buffer attribute.
	*/
	toJSON() {
		const data = {
			itemSize: this.itemSize,
			type: this.array.constructor.name,
			array: Array.from(this.array),
			normalized: this.normalized
		};
		if (this.name !== "") data.name = this.name;
		if (this.usage !== 35044) data.usage = this.usage;
		return data;
	}
	/**
	* Disposes of the buffer attribute. Available only in {@link WebGPURenderer}.
	*/
	dispose() {
		this.dispatchEvent({ type: "dispose" });
	}
};
/**
* Convenient class that can be used when creating a `UInt16` buffer attribute with
* a plain `Array` instance.
*
* @augments BufferAttribute
*/
var Uint16BufferAttribute = class extends BufferAttribute {
	/**
	* Constructs a new buffer attribute.
	*
	* @param {(Array<number>|Uint16Array)} array - The array holding the attribute data.
	* @param {number} itemSize - The item size.
	* @param {boolean} [normalized=false] - Whether the data are normalized or not.
	*/
	constructor(array, itemSize, normalized) {
		super(new Uint16Array(array), itemSize, normalized);
	}
};
/**
* Convenient class that can be used when creating a `UInt32` buffer attribute with
* a plain `Array` instance.
*
* @augments BufferAttribute
*/
var Uint32BufferAttribute = class extends BufferAttribute {
	/**
	* Constructs a new buffer attribute.
	*
	* @param {(Array<number>|Uint32Array)} array - The array holding the attribute data.
	* @param {number} itemSize - The item size.
	* @param {boolean} [normalized=false] - Whether the data are normalized or not.
	*/
	constructor(array, itemSize, normalized) {
		super(new Uint32Array(array), itemSize, normalized);
	}
};
/**
* Convenient class that can be used when creating a `Float32` buffer attribute with
* a plain `Array` instance.
*
* @augments BufferAttribute
*/
var Float32BufferAttribute = class extends BufferAttribute {
	/**
	* Constructs a new buffer attribute.
	*
	* @param {(Array<number>|Float32Array)} array - The array holding the attribute data.
	* @param {number} itemSize - The item size.
	* @param {boolean} [normalized=false] - Whether the data are normalized or not.
	*/
	constructor(array, itemSize, normalized) {
		super(new Float32Array(array), itemSize, normalized);
	}
};
const _box$3 = /*@__PURE__*/ new Box3();
const _v1$3 = /*@__PURE__*/ new Vector3();
const _v2$2 = /*@__PURE__*/ new Vector3();
/**
* An analytical 3D sphere defined by a center and radius. This class is mainly
* used as a Bounding Sphere for 3D objects.
*/
var Sphere = class {
	/**
	* Constructs a new sphere.
	*
	* @param {Vector3} [center=(0,0,0)] - The center of the sphere
	* @param {number} [radius=-1] - The radius of the sphere.
	*/
	constructor(center = new Vector3(), radius = -1) {
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isSphere = true;
		/**
		* The center of the sphere
		*
		* @type {Vector3}
		*/
		this.center = center;
		/**
		* The radius of the sphere.
		*
		* @type {number}
		*/
		this.radius = radius;
	}
	/**
	* Sets the sphere's components by copying the given values.
	*
	* @param {Vector3} center - The center.
	* @param {number} radius - The radius.
	* @return {Sphere} A reference to this sphere.
	*/
	set(center, radius) {
		this.center.copy(center);
		this.radius = radius;
		return this;
	}
	/**
	* Computes the minimum bounding sphere for list of points.
	* If the optional center point is given, it is used as the sphere's
	* center. Otherwise, the center of the axis-aligned bounding box
	* encompassing the points is calculated.
	*
	* @param {Array<Vector3>} points - A list of points in 3D space.
	* @param {Vector3} [optionalCenter] - The center of the sphere.
	* @return {Sphere} A reference to this sphere.
	*/
	setFromPoints(points, optionalCenter) {
		const center = this.center;
		if (optionalCenter !== void 0) center.copy(optionalCenter);
		else _box$3.setFromPoints(points).getCenter(center);
		let maxRadiusSq = 0;
		for (let i = 0, il = points.length; i < il; i++) maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(points[i]));
		this.radius = Math.sqrt(maxRadiusSq);
		return this;
	}
	/**
	* Copies the values of the given sphere to this instance.
	*
	* @param {Sphere} sphere - The sphere to copy.
	* @return {Sphere} A reference to this sphere.
	*/
	copy(sphere) {
		this.center.copy(sphere.center);
		this.radius = sphere.radius;
		return this;
	}
	/**
	* Returns `true` if the sphere is empty (the radius set to a negative number).
	*
	* Spheres with a radius of `0` contain only their center point and are not
	* considered to be empty.
	*
	* @return {boolean} Whether this sphere is empty or not.
	*/
	isEmpty() {
		return this.radius < 0;
	}
	/**
	* Makes this sphere empty which means in encloses a zero space in 3D.
	*
	* @return {Sphere} A reference to this sphere.
	*/
	makeEmpty() {
		this.center.set(0, 0, 0);
		this.radius = -1;
		return this;
	}
	/**
	* Returns `true` if this sphere contains the given point inclusive of
	* the surface of the sphere.
	*
	* @param {Vector3} point - The point to check.
	* @return {boolean} Whether this sphere contains the given point or not.
	*/
	containsPoint(point) {
		return point.distanceToSquared(this.center) <= this.radius * this.radius;
	}
	/**
	* Returns the closest distance from the boundary of the sphere to the
	* given point. If the sphere contains the point, the distance will
	* be negative.
	*
	* @param {Vector3} point - The point to compute the distance to.
	* @return {number} The distance to the point.
	*/
	distanceToPoint(point) {
		return point.distanceTo(this.center) - this.radius;
	}
	/**
	* Returns `true` if this sphere intersects with the given one.
	*
	* @param {Sphere} sphere - The sphere to test.
	* @return {boolean} Whether this sphere intersects with the given one or not.
	*/
	intersectsSphere(sphere) {
		const radiusSum = this.radius + sphere.radius;
		return sphere.center.distanceToSquared(this.center) <= radiusSum * radiusSum;
	}
	/**
	* Returns `true` if this sphere intersects with the given box.
	*
	* @param {Box3} box - The box to test.
	* @return {boolean} Whether this sphere intersects with the given box or not.
	*/
	intersectsBox(box) {
		return box.intersectsSphere(this);
	}
	/**
	* Returns `true` if this sphere intersects with the given plane.
	*
	* @param {Plane} plane - The plane to test.
	* @return {boolean} Whether this sphere intersects with the given plane or not.
	*/
	intersectsPlane(plane) {
		return Math.abs(plane.distanceToPoint(this.center)) <= this.radius;
	}
	/**
	* Clamps a point within the sphere. If the point is outside the sphere, it
	* will clamp it to the closest point on the edge of the sphere. Points
	* already inside the sphere will not be affected.
	*
	* @param {Vector3} point - The plane to clamp.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {Vector3} The clamped point.
	*/
	clampPoint(point, target) {
		const deltaLengthSq = this.center.distanceToSquared(point);
		target.copy(point);
		if (deltaLengthSq > this.radius * this.radius) {
			target.sub(this.center).normalize();
			target.multiplyScalar(this.radius).add(this.center);
		}
		return target;
	}
	/**
	* Returns a bounding box that encloses this sphere.
	*
	* @param {Box3} target - The target box that is used to store the method's result.
	* @return {Box3} The bounding box that encloses this sphere.
	*/
	getBoundingBox(target) {
		if (this.isEmpty()) {
			target.makeEmpty();
			return target;
		}
		target.set(this.center, this.center);
		target.expandByScalar(this.radius);
		return target;
	}
	/**
	* Transforms this sphere with the given 4x4 transformation matrix.
	*
	* @param {Matrix4} matrix - The transformation matrix.
	* @return {Sphere} A reference to this sphere.
	*/
	applyMatrix4(matrix) {
		this.center.applyMatrix4(matrix);
		this.radius = this.radius * matrix.getMaxScaleOnAxis();
		return this;
	}
	/**
	* Translates the sphere's center by the given offset.
	*
	* @param {Vector3} offset - The offset.
	* @return {Sphere} A reference to this sphere.
	*/
	translate(offset) {
		this.center.add(offset);
		return this;
	}
	/**
	* Expands the boundaries of this sphere to include the given point.
	*
	* @param {Vector3} point - The point to include.
	* @return {Sphere} A reference to this sphere.
	*/
	expandByPoint(point) {
		if (this.isEmpty()) {
			this.center.copy(point);
			this.radius = 0;
			return this;
		}
		_v1$3.subVectors(point, this.center);
		const lengthSq = _v1$3.lengthSq();
		if (lengthSq > this.radius * this.radius) {
			const length = Math.sqrt(lengthSq);
			const delta = (length - this.radius) * .5;
			this.center.addScaledVector(_v1$3, delta / length);
			this.radius += delta;
		}
		return this;
	}
	/**
	* Expands this sphere to enclose both the original sphere and the given sphere.
	*
	* @param {Sphere} sphere - The sphere to include.
	* @return {Sphere} A reference to this sphere.
	*/
	union(sphere) {
		if (sphere.isEmpty()) return this;
		if (this.isEmpty()) {
			this.copy(sphere);
			return this;
		}
		if (this.center.equals(sphere.center) === true) this.radius = Math.max(this.radius, sphere.radius);
		else {
			_v2$2.subVectors(sphere.center, this.center).setLength(sphere.radius);
			this.expandByPoint(_v1$3.copy(sphere.center).add(_v2$2));
			this.expandByPoint(_v1$3.copy(sphere.center).sub(_v2$2));
		}
		return this;
	}
	/**
	* Returns `true` if this sphere is equal with the given one.
	*
	* @param {Sphere} sphere - The sphere to test for equality.
	* @return {boolean} Whether this bounding sphere is equal with the given one.
	*/
	equals(sphere) {
		return sphere.center.equals(this.center) && sphere.radius === this.radius;
	}
	/**
	* Returns a new sphere with copied values from this instance.
	*
	* @return {Sphere} A clone of this instance.
	*/
	clone() {
		return new this.constructor().copy(this);
	}
	/**
	* Returns a serialized structure of the bounding sphere.
	*
	* @return {Object} Serialized structure with fields representing the object state.
	*/
	toJSON() {
		return {
			radius: this.radius,
			center: this.center.toArray()
		};
	}
	/**
	* Returns a serialized structure of the bounding sphere.
	*
	* @param {Object} json - The serialized json to set the sphere from.
	* @return {Sphere} A reference to this bounding sphere.
	*/
	fromJSON(json) {
		this.radius = json.radius;
		this.center.fromArray(json.center);
		return this;
	}
};
let _id$1 = 0;
const _m1 = /*@__PURE__*/ new Matrix4();
const _obj = /*@__PURE__*/ new Object3D();
const _offset = /*@__PURE__*/ new Vector3();
const _box$2 = /*@__PURE__*/ new Box3();
const _boxMorphTargets = /*@__PURE__*/ new Box3();
const _vector$9 = /*@__PURE__*/ new Vector3();
/**
* A representation of mesh, line, or point geometry. Includes vertex
* positions, face indices, normals, colors, UVs, and custom attributes
* within buffers, reducing the cost of passing all this data to the GPU.
*
* ```js
* const geometry = new THREE.BufferGeometry();
* // create a simple square shape. We duplicate the top left and bottom right
* // vertices because each vertex needs to appear once per triangle.
* const vertices = new Float32Array( [
* 	-1.0, -1.0,  1.0, // v0
* 	 1.0, -1.0,  1.0, // v1
* 	 1.0,  1.0,  1.0, // v2
*
* 	 1.0,  1.0,  1.0, // v3
* 	-1.0,  1.0,  1.0, // v4
* 	-1.0, -1.0,  1.0  // v5
* ] );
* // itemSize = 3 because there are 3 values (components) per vertex
* geometry.setAttribute( 'position', new THREE.BufferAttribute( vertices, 3 ) );
* const material = new THREE.MeshBasicMaterial( { color: 0xff0000 } );
* const mesh = new THREE.Mesh( geometry, material );
* ```
*
* @augments EventDispatcher
*/
var BufferGeometry = class BufferGeometry extends EventDispatcher {
	/**
	* Constructs a new geometry.
	*/
	constructor() {
		super();
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isBufferGeometry = true;
		/**
		* The ID of the geometry.
		*
		* @name BufferGeometry#id
		* @type {number}
		* @readonly
		*/
		Object.defineProperty(this, "id", { value: _id$1++ });
		/**
		* The UUID of the geometry.
		*
		* @type {string}
		* @readonly
		*/
		this.uuid = generateUUID();
		/**
		* The name of the geometry.
		*
		* @type {string}
		*/
		this.name = "";
		this.type = "BufferGeometry";
		/**
		* Allows for vertices to be re-used across multiple triangles; this is
		* called using "indexed triangles". Each triangle is associated with the
		* indices of three vertices. This attribute therefore stores the index of
		* each vertex for each triangular face. If this attribute is not set, the
		* renderer assumes that each three contiguous positions represent a single triangle.
		*
		* @type {?BufferAttribute}
		* @default null
		*/
		this.index = null;
		/**
		* A (storage) buffer attribute which was generated with a compute shader and
		* now defines indirect draw calls.
		*
		* Can only be used with {@link WebGPURenderer} and a WebGPU backend.
		*
		* @type {?BufferAttribute}
		* @default null
		*/
		this.indirect = null;
		/**
		* The offset, in bytes, into the indirect drawing buffer where the value data begins. If an array is provided, multiple indirect draw calls will be made for each offset.
		*
		* Can only be used with {@link WebGPURenderer} and a WebGPU backend.
		*
		* @type {number|Array<number>}
		* @default 0
		*/
		this.indirectOffset = 0;
		/**
		* This dictionary has as id the name of the attribute to be set and as value
		* the buffer attribute to set it to. Rather than accessing this property directly,
		* use `setAttribute()` and `getAttribute()` to access attributes of this geometry.
		*
		* @type {Object<string,(BufferAttribute|InterleavedBufferAttribute)>}
		*/
		this.attributes = {};
		/**
		* This dictionary holds the morph targets of the geometry.
		*
		* Note: Once the geometry has been rendered, the morph attribute data cannot
		* be changed. You will have to call `dispose()`, and create a new geometry instance.
		*
		* @type {Object}
		*/
		this.morphAttributes = {};
		/**
		* Used to control the morph target behavior; when set to `true`, the morph
		* target data is treated as relative offsets, rather than as absolute
		* positions/normals.
		*
		* @type {boolean}
		* @default false
		*/
		this.morphTargetsRelative = false;
		/**
		* Split the geometry into groups, each of which will be rendered in a
		* separate draw call. This allows an array of materials to be used with the geometry.
		*
		* Use `addGroup()` and `clearGroups()` to edit groups, rather than modifying this array directly.
		*
		* Every vertex and index must belong to exactly one group — groups must not share vertices or
		* indices, and must not leave vertices or indices unused.
		*
		* @type {Array<Object>}
		*/
		this.groups = [];
		/**
		* Bounding box for the geometry which can be calculated with `computeBoundingBox()`.
		*
		* @type {?Box3}
		* @default null
		*/
		this.boundingBox = null;
		/**
		* Bounding sphere for the geometry which can be calculated with `computeBoundingSphere()`.
		*
		* @type {?Sphere}
		* @default null
		*/
		this.boundingSphere = null;
		/**
		* Determines the part of the geometry to render. This should not be set directly,
		* instead use `setDrawRange()`.
		*
		* @type {{start:number,count:number}}
		*/
		this.drawRange = {
			start: 0,
			count: Infinity
		};
		/**
		* An object that can be used to store custom data about the geometry.
		* It should not hold references to functions as these will not be cloned.
		*
		* @type {Object}
		*/
		this.userData = {};
		/**
		* `true` when the geometry has been transformed since construction
		* (e.g. via {@link BufferGeometry#applyMatrix4}). Only relevant for
		* geometry generators (subclasses that populate `parameters`): when set,
		* {@link BufferGeometry#toJSON} omits `parameters` since they no longer
		* describe the geometry.
		*
		* @private
		* @type {boolean}
		* @default false
		*/
		this._transformed = false;
	}
	/**
	* Returns the index of this geometry.
	*
	* @return {?BufferAttribute} The index. Returns `null` if no index is defined.
	*/
	getIndex() {
		return this.index;
	}
	/**
	* Sets the given index to this geometry.
	*
	* @param {Array<number>|BufferAttribute} index - The index to set.
	* @return {BufferGeometry} A reference to this instance.
	*/
	setIndex(index) {
		if (Array.isArray(index)) this.index = new (arrayNeedsUint32(index) ? Uint32BufferAttribute : Uint16BufferAttribute)(index, 1);
		else this.index = index;
		return this;
	}
	/**
	* Sets the given indirect attribute to this geometry.
	*
	* @param {BufferAttribute} indirect - The attribute holding indirect draw calls.
	* @param {number|Array<number>} [indirectOffset=0] - The offset, in bytes, into the indirect drawing buffer where the value data begins. If an array is provided, multiple indirect draw calls will be made for each offset.
	* @return {BufferGeometry} A reference to this instance.
	*/
	setIndirect(indirect, indirectOffset = 0) {
		this.indirect = indirect;
		this.indirectOffset = indirectOffset;
		return this;
	}
	/**
	* Returns the indirect attribute of this geometry.
	*
	* @return {?BufferAttribute} The indirect attribute. Returns `null` if no indirect attribute is defined.
	*/
	getIndirect() {
		return this.indirect;
	}
	/**
	* Returns the buffer attribute for the given name.
	*
	* @param {string} name - The attribute name.
	* @return {BufferAttribute|InterleavedBufferAttribute|undefined} The buffer attribute.
	* Returns `undefined` if not attribute has been found.
	*/
	getAttribute(name) {
		return this.attributes[name];
	}
	/**
	* Sets the given attribute for the given name.
	*
	* @param {string} name - The attribute name.
	* @param {BufferAttribute|InterleavedBufferAttribute} attribute - The attribute to set.
	* @return {BufferGeometry} A reference to this instance.
	*/
	setAttribute(name, attribute) {
		this.attributes[name] = attribute;
		return this;
	}
	/**
	* Deletes the attribute for the given name.
	*
	* @param {string} name - The attribute name to delete.
	* @return {BufferGeometry} A reference to this instance.
	*/
	deleteAttribute(name) {
		delete this.attributes[name];
		return this;
	}
	/**
	* Returns `true` if this geometry has an attribute for the given name.
	*
	* @param {string} name - The attribute name.
	* @return {boolean} Whether this geometry has an attribute for the given name or not.
	*/
	hasAttribute(name) {
		return this.attributes[name] !== void 0;
	}
	/**
	* Adds a group to this geometry.
	*
	* @param {number} start - The first element in this draw call. That is the first
	* vertex for non-indexed geometry, otherwise the first triangle index.
	* @param {number} count - Specifies how many vertices (or indices) are part of this group.
	* @param {number} [materialIndex=0] - The material array index to use.
	*/
	addGroup(start, count, materialIndex = 0) {
		this.groups.push({
			start,
			count,
			materialIndex
		});
	}
	/**
	* Clears all groups.
	*/
	clearGroups() {
		this.groups = [];
	}
	/**
	* Sets the draw range for this geometry.
	*
	* @param {number} start - The first vertex for non-indexed geometry, otherwise the first triangle index.
	* @param {number} count - For non-indexed BufferGeometry, `count` is the number of vertices to render.
	* For indexed BufferGeometry, `count` is the number of indices to render.
	*/
	setDrawRange(start, count) {
		this.drawRange.start = start;
		this.drawRange.count = count;
	}
	/**
	* Applies the given 4x4 transformation matrix to the geometry.
	*
	* @param {Matrix4} matrix - The matrix to apply.
	* @return {BufferGeometry} A reference to this instance.
	*/
	applyMatrix4(matrix) {
		const position = this.attributes.position;
		if (position !== void 0) {
			position.applyMatrix4(matrix);
			position.needsUpdate = true;
		}
		const normal = this.attributes.normal;
		if (normal !== void 0) {
			const normalMatrix = new Matrix3().getNormalMatrix(matrix);
			normal.applyNormalMatrix(normalMatrix);
			normal.needsUpdate = true;
		}
		const tangent = this.attributes.tangent;
		if (tangent !== void 0) {
			tangent.transformDirection(matrix);
			tangent.needsUpdate = true;
		}
		if (this.boundingBox !== null) this.computeBoundingBox();
		if (this.boundingSphere !== null) this.computeBoundingSphere();
		this._transformed = true;
		return this;
	}
	/**
	* Applies the rotation represented by the Quaternion to the geometry.
	*
	* @param {Quaternion} q - The Quaternion to apply.
	* @return {BufferGeometry} A reference to this instance.
	*/
	applyQuaternion(q) {
		_m1.makeRotationFromQuaternion(q);
		this.applyMatrix4(_m1);
		return this;
	}
	/**
	* Rotates the geometry about the X axis. This is typically done as a one time
	* operation, and not during a loop. Use {@link Object3D#rotation} for typical
	* real-time mesh rotation.
	*
	* @param {number} angle - The angle in radians.
	* @return {BufferGeometry} A reference to this instance.
	*/
	rotateX(angle) {
		_m1.makeRotationX(angle);
		this.applyMatrix4(_m1);
		return this;
	}
	/**
	* Rotates the geometry about the Y axis. This is typically done as a one time
	* operation, and not during a loop. Use {@link Object3D#rotation} for typical
	* real-time mesh rotation.
	*
	* @param {number} angle - The angle in radians.
	* @return {BufferGeometry} A reference to this instance.
	*/
	rotateY(angle) {
		_m1.makeRotationY(angle);
		this.applyMatrix4(_m1);
		return this;
	}
	/**
	* Rotates the geometry about the Z axis. This is typically done as a one time
	* operation, and not during a loop. Use {@link Object3D#rotation} for typical
	* real-time mesh rotation.
	*
	* @param {number} angle - The angle in radians.
	* @return {BufferGeometry} A reference to this instance.
	*/
	rotateZ(angle) {
		_m1.makeRotationZ(angle);
		this.applyMatrix4(_m1);
		return this;
	}
	/**
	* Translates the geometry. This is typically done as a one time
	* operation, and not during a loop. Use {@link Object3D#position} for typical
	* real-time mesh rotation.
	*
	* @param {number} x - The x offset.
	* @param {number} y - The y offset.
	* @param {number} z - The z offset.
	* @return {BufferGeometry} A reference to this instance.
	*/
	translate(x, y, z) {
		_m1.makeTranslation(x, y, z);
		this.applyMatrix4(_m1);
		return this;
	}
	/**
	* Scales the geometry. This is typically done as a one time
	* operation, and not during a loop. Use {@link Object3D#scale} for typical
	* real-time mesh rotation.
	*
	* @param {number} x - The x scale.
	* @param {number} y - The y scale.
	* @param {number} z - The z scale.
	* @return {BufferGeometry} A reference to this instance.
	*/
	scale(x, y, z) {
		_m1.makeScale(x, y, z);
		this.applyMatrix4(_m1);
		return this;
	}
	/**
	* Rotates the geometry to face a point in 3D space. This is typically done as a one time
	* operation, and not during a loop. Use {@link Object3D#lookAt} for typical
	* real-time mesh rotation.
	*
	* @param {Vector3} vector - The target point.
	* @return {BufferGeometry} A reference to this instance.
	*/
	lookAt(vector) {
		_obj.lookAt(vector);
		_obj.updateMatrix();
		this.applyMatrix4(_obj.matrix);
		return this;
	}
	/**
	* Center the geometry based on its bounding box.
	*
	* @return {BufferGeometry} A reference to this instance.
	*/
	center() {
		this.computeBoundingBox();
		this.boundingBox.getCenter(_offset).negate();
		this.translate(_offset.x, _offset.y, _offset.z);
		return this;
	}
	/**
	* Defines a geometry by creating a `position` attribute based on the given array of points. The array
	* can hold 2D or 3D vectors. When using two-dimensional data, the `z` coordinate for all vertices is
	* set to `0`.
	*
	* If the method is used with an existing `position` attribute, the vertex data are overwritten with the
	* data from the array. The length of the array must match the vertex count.
	*
	* @param {Array<Vector2>|Array<Vector3>} points - The points.
	* @return {BufferGeometry} A reference to this instance.
	*/
	setFromPoints(points) {
		const positionAttribute = this.getAttribute("position");
		if (positionAttribute === void 0) {
			const position = [];
			for (let i = 0, l = points.length; i < l; i++) {
				const point = points[i];
				position.push(point.x, point.y, point.z || 0);
			}
			this.setAttribute("position", new Float32BufferAttribute(position, 3));
		} else {
			const l = Math.min(points.length, positionAttribute.count);
			for (let i = 0; i < l; i++) {
				const point = points[i];
				positionAttribute.setXYZ(i, point.x, point.y, point.z || 0);
			}
			if (points.length > positionAttribute.count) warn("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry.");
			positionAttribute.needsUpdate = true;
		}
		return this;
	}
	/**
	* Computes the bounding box of the geometry, and updates the `boundingBox` member.
	* The bounding box is not computed by the engine; it must be computed by your app.
	* You may need to recompute the bounding box if the geometry vertices are modified.
	*/
	computeBoundingBox() {
		if (this.boundingBox === null) this.boundingBox = new Box3();
		const position = this.attributes.position;
		const morphAttributesPosition = this.morphAttributes.position;
		if (position && position.isGLBufferAttribute) {
			error("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.", this);
			this.boundingBox.set(new Vector3(-Infinity, -Infinity, -Infinity), new Vector3(Infinity, Infinity, Infinity));
			return;
		}
		if (position !== void 0) {
			this.boundingBox.setFromBufferAttribute(position);
			if (morphAttributesPosition) for (let i = 0, il = morphAttributesPosition.length; i < il; i++) {
				const morphAttribute = morphAttributesPosition[i];
				_box$2.setFromBufferAttribute(morphAttribute);
				if (this.morphTargetsRelative) {
					_vector$9.addVectors(this.boundingBox.min, _box$2.min);
					this.boundingBox.expandByPoint(_vector$9);
					_vector$9.addVectors(this.boundingBox.max, _box$2.max);
					this.boundingBox.expandByPoint(_vector$9);
				} else {
					this.boundingBox.expandByPoint(_box$2.min);
					this.boundingBox.expandByPoint(_box$2.max);
				}
			}
		} else this.boundingBox.makeEmpty();
		if (isNaN(this.boundingBox.min.x) || isNaN(this.boundingBox.min.y) || isNaN(this.boundingBox.min.z)) error("BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The \"position\" attribute is likely to have NaN values.", this);
	}
	/**
	* Computes the bounding sphere of the geometry, and updates the `boundingSphere` member.
	* The engine automatically computes the bounding sphere when it is needed, e.g., for ray casting or view frustum culling.
	* You may need to recompute the bounding sphere if the geometry vertices are modified.
	*/
	computeBoundingSphere() {
		if (this.boundingSphere === null) this.boundingSphere = new Sphere();
		const position = this.attributes.position;
		const morphAttributesPosition = this.morphAttributes.position;
		if (position && position.isGLBufferAttribute) {
			error("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.", this);
			this.boundingSphere.set(new Vector3(), Infinity);
			return;
		}
		if (position) {
			const center = this.boundingSphere.center;
			_box$2.setFromBufferAttribute(position);
			if (morphAttributesPosition) for (let i = 0, il = morphAttributesPosition.length; i < il; i++) {
				const morphAttribute = morphAttributesPosition[i];
				_boxMorphTargets.setFromBufferAttribute(morphAttribute);
				if (this.morphTargetsRelative) {
					_vector$9.addVectors(_box$2.min, _boxMorphTargets.min);
					_box$2.expandByPoint(_vector$9);
					_vector$9.addVectors(_box$2.max, _boxMorphTargets.max);
					_box$2.expandByPoint(_vector$9);
				} else {
					_box$2.expandByPoint(_boxMorphTargets.min);
					_box$2.expandByPoint(_boxMorphTargets.max);
				}
			}
			_box$2.getCenter(center);
			let maxRadiusSq = 0;
			for (let i = 0, il = position.count; i < il; i++) {
				_vector$9.fromBufferAttribute(position, i);
				maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector$9));
			}
			if (morphAttributesPosition) for (let i = 0, il = morphAttributesPosition.length; i < il; i++) {
				const morphAttribute = morphAttributesPosition[i];
				const morphTargetsRelative = this.morphTargetsRelative;
				for (let j = 0, jl = morphAttribute.count; j < jl; j++) {
					_vector$9.fromBufferAttribute(morphAttribute, j);
					if (morphTargetsRelative) {
						_offset.fromBufferAttribute(position, j);
						_vector$9.add(_offset);
					}
					maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector$9));
				}
			}
			this.boundingSphere.radius = Math.sqrt(maxRadiusSq);
			if (isNaN(this.boundingSphere.radius)) error("BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The \"position\" attribute is likely to have NaN values.", this);
		}
	}
	/**
	* Calculates and adds a tangent attribute to this geometry.
	*
	* The computation is only supported for indexed geometries and if position, normal, and uv attributes
	* are defined. When using a tangent space normal map, prefer the MikkTSpace algorithm provided by
	* {@link BufferGeometryUtils#computeMikkTSpaceTangents} instead.
	*/
	computeTangents() {
		const index = this.index;
		const attributes = this.attributes;
		if (index === null || attributes.position === void 0 || attributes.normal === void 0 || attributes.uv === void 0) {
			error("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");
			return;
		}
		const positionAttribute = attributes.position;
		const normalAttribute = attributes.normal;
		const uvAttribute = attributes.uv;
		let tangentAttribute = this.getAttribute("tangent");
		if (tangentAttribute === void 0 || tangentAttribute.count !== positionAttribute.count) {
			tangentAttribute = new BufferAttribute(new Float32Array(4 * positionAttribute.count), 4);
			this.setAttribute("tangent", tangentAttribute);
		}
		const tan1 = [], tan2 = [];
		for (let i = 0; i < positionAttribute.count; i++) {
			tan1[i] = new Vector3();
			tan2[i] = new Vector3();
		}
		const vA = new Vector3(), vB = new Vector3(), vC = new Vector3(), uvA = new Vector2(), uvB = new Vector2(), uvC = new Vector2(), sdir = new Vector3(), tdir = new Vector3();
		function handleTriangle(a, b, c) {
			vA.fromBufferAttribute(positionAttribute, a);
			vB.fromBufferAttribute(positionAttribute, b);
			vC.fromBufferAttribute(positionAttribute, c);
			uvA.fromBufferAttribute(uvAttribute, a);
			uvB.fromBufferAttribute(uvAttribute, b);
			uvC.fromBufferAttribute(uvAttribute, c);
			vB.sub(vA);
			vC.sub(vA);
			uvB.sub(uvA);
			uvC.sub(uvA);
			const r = 1 / (uvB.x * uvC.y - uvC.x * uvB.y);
			if (!isFinite(r)) return;
			sdir.copy(vB).multiplyScalar(uvC.y).addScaledVector(vC, -uvB.y).multiplyScalar(r);
			tdir.copy(vC).multiplyScalar(uvB.x).addScaledVector(vB, -uvC.x).multiplyScalar(r);
			tan1[a].add(sdir);
			tan1[b].add(sdir);
			tan1[c].add(sdir);
			tan2[a].add(tdir);
			tan2[b].add(tdir);
			tan2[c].add(tdir);
		}
		let groups = this.groups;
		if (groups.length === 0) groups = [{
			start: 0,
			count: index.count
		}];
		for (let i = 0, il = groups.length; i < il; ++i) {
			const group = groups[i];
			const start = group.start;
			const count = group.count;
			for (let j = start, jl = start + count; j < jl; j += 3) handleTriangle(index.getX(j + 0), index.getX(j + 1), index.getX(j + 2));
		}
		const tmp = new Vector3(), tmp2 = new Vector3();
		const n = new Vector3(), n2 = new Vector3();
		function handleVertex(v) {
			n.fromBufferAttribute(normalAttribute, v);
			n2.copy(n);
			const t = tan1[v];
			tmp.copy(t);
			tmp.sub(n.multiplyScalar(n.dot(t))).normalize();
			tmp2.crossVectors(n2, t);
			const w = tmp2.dot(tan2[v]) < 0 ? -1 : 1;
			tangentAttribute.setXYZW(v, tmp.x, tmp.y, tmp.z, w);
		}
		for (let i = 0, il = groups.length; i < il; ++i) {
			const group = groups[i];
			const start = group.start;
			const count = group.count;
			for (let j = start, jl = start + count; j < jl; j += 3) {
				handleVertex(index.getX(j + 0));
				handleVertex(index.getX(j + 1));
				handleVertex(index.getX(j + 2));
			}
		}
		this._transformed = true;
	}
	/**
	* Computes vertex normals for the given vertex data. For indexed geometries, the method sets
	* each vertex normal to be the average of the face normals of the faces that share that vertex.
	* For non-indexed geometries, vertices are not shared, and the method sets each vertex normal
	* to be the same as the face normal.
	*/
	computeVertexNormals() {
		const index = this.index;
		const positionAttribute = this.getAttribute("position");
		if (positionAttribute !== void 0) {
			let normalAttribute = this.getAttribute("normal");
			if (normalAttribute === void 0 || normalAttribute.count !== positionAttribute.count) {
				normalAttribute = new BufferAttribute(new Float32Array(positionAttribute.count * 3), 3);
				this.setAttribute("normal", normalAttribute);
			} else for (let i = 0, il = normalAttribute.count; i < il; i++) normalAttribute.setXYZ(i, 0, 0, 0);
			const pA = new Vector3(), pB = new Vector3(), pC = new Vector3();
			const nA = new Vector3(), nB = new Vector3(), nC = new Vector3();
			const cb = new Vector3(), ab = new Vector3();
			if (index) for (let i = 0, il = index.count; i < il; i += 3) {
				const vA = index.getX(i + 0);
				const vB = index.getX(i + 1);
				const vC = index.getX(i + 2);
				pA.fromBufferAttribute(positionAttribute, vA);
				pB.fromBufferAttribute(positionAttribute, vB);
				pC.fromBufferAttribute(positionAttribute, vC);
				cb.subVectors(pC, pB);
				ab.subVectors(pA, pB);
				cb.cross(ab);
				nA.fromBufferAttribute(normalAttribute, vA);
				nB.fromBufferAttribute(normalAttribute, vB);
				nC.fromBufferAttribute(normalAttribute, vC);
				nA.add(cb);
				nB.add(cb);
				nC.add(cb);
				normalAttribute.setXYZ(vA, nA.x, nA.y, nA.z);
				normalAttribute.setXYZ(vB, nB.x, nB.y, nB.z);
				normalAttribute.setXYZ(vC, nC.x, nC.y, nC.z);
			}
			else for (let i = 0, il = positionAttribute.count; i < il; i += 3) {
				pA.fromBufferAttribute(positionAttribute, i + 0);
				pB.fromBufferAttribute(positionAttribute, i + 1);
				pC.fromBufferAttribute(positionAttribute, i + 2);
				cb.subVectors(pC, pB);
				ab.subVectors(pA, pB);
				cb.cross(ab);
				normalAttribute.setXYZ(i + 0, cb.x, cb.y, cb.z);
				normalAttribute.setXYZ(i + 1, cb.x, cb.y, cb.z);
				normalAttribute.setXYZ(i + 2, cb.x, cb.y, cb.z);
			}
			this.normalizeNormals();
			normalAttribute.needsUpdate = true;
		}
	}
	/**
	* Ensures every normal vector in a geometry will have a magnitude of `1`. This will
	* correct lighting on the geometry surfaces.
	*/
	normalizeNormals() {
		const normals = this.attributes.normal;
		for (let i = 0, il = normals.count; i < il; i++) {
			_vector$9.fromBufferAttribute(normals, i);
			_vector$9.normalize();
			normals.setXYZ(i, _vector$9.x, _vector$9.y, _vector$9.z);
		}
	}
	/**
	* Return a new non-index version of this indexed geometry. If the geometry
	* is already non-indexed, the method is a NOOP.
	*
	* @return {BufferGeometry} The non-indexed version of this indexed geometry.
	*/
	toNonIndexed() {
		function convertBufferAttribute(attribute, indices) {
			const array = attribute.array;
			const itemSize = attribute.itemSize;
			const normalized = attribute.normalized;
			const array2 = new array.constructor(indices.length * itemSize);
			let index = 0, index2 = 0;
			for (let i = 0, l = indices.length; i < l; i++) {
				if (attribute.isInterleavedBufferAttribute) index = indices[i] * attribute.data.stride + attribute.offset;
				else index = indices[i] * itemSize;
				for (let j = 0; j < itemSize; j++) array2[index2++] = array[index++];
			}
			return new BufferAttribute(array2, itemSize, normalized);
		}
		if (this.index === null) {
			warn("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed.");
			return this;
		}
		const geometry2 = new BufferGeometry();
		const indices = this.index.array;
		const attributes = this.attributes;
		for (const name in attributes) {
			const attribute = attributes[name];
			const newAttribute = convertBufferAttribute(attribute, indices);
			geometry2.setAttribute(name, newAttribute);
		}
		const morphAttributes = this.morphAttributes;
		for (const name in morphAttributes) {
			const morphArray = [];
			const morphAttribute = morphAttributes[name];
			for (let i = 0, il = morphAttribute.length; i < il; i++) {
				const attribute = morphAttribute[i];
				const newAttribute = convertBufferAttribute(attribute, indices);
				morphArray.push(newAttribute);
			}
			geometry2.morphAttributes[name] = morphArray;
		}
		geometry2.morphTargetsRelative = this.morphTargetsRelative;
		const groups = this.groups;
		for (let i = 0, l = groups.length; i < l; i++) {
			const group = groups[i];
			geometry2.addGroup(group.start, group.count, group.materialIndex);
		}
		return geometry2;
	}
	/**
	* Serializes the geometry into JSON.
	*
	* @return {Object} A JSON object representing the serialized geometry.
	*/
	toJSON() {
		const data = { metadata: {
			version: 4.7,
			type: "BufferGeometry",
			generator: "BufferGeometry.toJSON"
		} };
		data.uuid = this.uuid;
		data.type = this.parameters !== void 0 && this._transformed === true ? "BufferGeometry" : this.type;
		if (this.name !== "") data.name = this.name;
		if (Object.keys(this.userData).length > 0) data.userData = this.userData;
		if (this.parameters !== void 0 && this._transformed !== true) {
			const parameters = this.parameters;
			for (const key in parameters) if (parameters[key] !== void 0) data[key] = parameters[key];
			return data;
		}
		data.data = { attributes: {} };
		const index = this.index;
		if (index !== null) data.data.index = {
			type: index.array.constructor.name,
			array: Array.prototype.slice.call(index.array)
		};
		const attributes = this.attributes;
		for (const key in attributes) {
			const attribute = attributes[key];
			data.data.attributes[key] = attribute.toJSON(data.data);
		}
		const morphAttributes = {};
		let hasMorphAttributes = false;
		for (const key in this.morphAttributes) {
			const attributeArray = this.morphAttributes[key];
			const array = [];
			for (let i = 0, il = attributeArray.length; i < il; i++) {
				const attribute = attributeArray[i];
				array.push(attribute.toJSON(data.data));
			}
			if (array.length > 0) {
				morphAttributes[key] = array;
				hasMorphAttributes = true;
			}
		}
		if (hasMorphAttributes) {
			data.data.morphAttributes = morphAttributes;
			data.data.morphTargetsRelative = this.morphTargetsRelative;
		}
		const groups = this.groups;
		if (groups.length > 0) data.data.groups = JSON.parse(JSON.stringify(groups));
		const boundingSphere = this.boundingSphere;
		if (boundingSphere !== null) data.data.boundingSphere = boundingSphere.toJSON();
		return data;
	}
	/**
	* Returns a new geometry with copied values from this instance.
	*
	* @return {BufferGeometry} A clone of this instance.
	*/
	clone() {
		return new this.constructor().copy(this);
	}
	/**
	* Copies the values of the given geometry to this instance.
	*
	* @param {BufferGeometry} source - The geometry to copy.
	* @return {BufferGeometry} A reference to this instance.
	*/
	copy(source) {
		this.index = null;
		this.attributes = {};
		this.morphAttributes = {};
		this.groups = [];
		this.boundingBox = null;
		this.boundingSphere = null;
		const data = {};
		this.name = source.name;
		const index = source.index;
		if (index !== null) this.setIndex(index.clone());
		const attributes = source.attributes;
		for (const name in attributes) {
			const attribute = attributes[name];
			this.setAttribute(name, attribute.clone(data));
		}
		const morphAttributes = source.morphAttributes;
		for (const name in morphAttributes) {
			const array = [];
			const morphAttribute = morphAttributes[name];
			for (let i = 0, l = morphAttribute.length; i < l; i++) array.push(morphAttribute[i].clone(data));
			this.morphAttributes[name] = array;
		}
		this.morphTargetsRelative = source.morphTargetsRelative;
		const groups = source.groups;
		for (let i = 0, l = groups.length; i < l; i++) {
			const group = groups[i];
			this.addGroup(group.start, group.count, group.materialIndex);
		}
		const boundingBox = source.boundingBox;
		if (boundingBox !== null) this.boundingBox = boundingBox.clone();
		const boundingSphere = source.boundingSphere;
		if (boundingSphere !== null) this.boundingSphere = boundingSphere.clone();
		this.drawRange.start = source.drawRange.start;
		this.drawRange.count = source.drawRange.count;
		this.userData = source.userData;
		this._transformed = source._transformed;
		return this;
	}
	/**
	* Frees the GPU-related resources allocated by this instance. Call this
	* method whenever this instance is no longer used in your app.
	*
	* @fires BufferGeometry#dispose
	*/
	dispose() {
		this.dispatchEvent({ type: "dispose" });
	}
};
let _materialId = 0;
/**
* Abstract base class for materials.
*
* Materials define the appearance of renderable 3D objects.
*
* @abstract
* @augments EventDispatcher
*/
var Material = class extends EventDispatcher {
	/**
	* Constructs a new material.
	*/
	constructor() {
		super();
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isMaterial = true;
		/**
		* The ID of the material.
		*
		* @name Material#id
		* @type {number}
		* @readonly
		*/
		Object.defineProperty(this, "id", { value: _materialId++ });
		/**
		* The UUID of the material.
		*
		* @type {string}
		* @readonly
		*/
		this.uuid = generateUUID();
		/**
		* The name of the material.
		*
		* @type {string}
		*/
		this.name = "";
		/**
		* The type property is used for detecting the object type
		* in context of serialization/deserialization.
		*
		* @type {string}
		* @readonly
		*/
		this.type = "Material";
		/**
		* Defines the blending type of the material.
		*
		* It must be set to `CustomBlending` if custom blending properties like
		* {@link Material#blendSrc}, {@link Material#blendDst} or {@link Material#blendEquation}
		* should have any effect.
		*
		* @type {(NoBlending|NormalBlending|AdditiveBlending|SubtractiveBlending|MultiplyBlending|CustomBlending)}
		* @default NormalBlending
		*/
		this.blending = 1;
		/**
		* Defines which side of faces will be rendered - front, back or both.
		*
		* @type {(FrontSide|BackSide|DoubleSide)}
		* @default FrontSide
		*/
		this.side = 0;
		/**
		* If set to `true`, vertex colors should be used.
		*
		* The engine supports RGB and RGBA vertex colors depending on whether a three (RGB) or
		* four (RGBA) component color buffer attribute is used.
		*
		* @type {boolean}
		* @default false
		*/
		this.vertexColors = false;
		/**
		* Defines how transparent the material is.
		* A value of `0.0` indicates fully transparent, `1.0` is fully opaque.
		*
		* If the {@link Material#transparent} is not set to `true`,
		* the material will remain fully opaque and this value will only affect its color.
		*
		* @type {number}
		* @default 1
		*/
		this.opacity = 1;
		/**
		* Defines whether this material is transparent. This has an effect on
		* rendering as transparent objects need special treatment and are rendered
		* after non-transparent objects.
		*
		* When set to true, the extent to which the material is transparent is
		* controlled by {@link Material#opacity}.
		*
		* @type {boolean}
		* @default false
		*/
		this.transparent = false;
		/**
		* Enables alpha hashed transparency, an alternative to {@link Material#transparent} or
		* {@link Material#alphaTest}. The material will not be rendered if opacity is lower than
		* a random threshold. Randomization introduces some grain or noise, but approximates alpha
		* blending without the associated problems of sorting. Using TAA can reduce the resulting noise.
		*
		* @type {boolean}
		* @default false
		*/
		this.alphaHash = false;
		/**
		* Defines the blending source factor.
		*
		* @type {(ZeroFactor|OneFactor|SrcColorFactor|OneMinusSrcColorFactor|SrcAlphaFactor|OneMinusSrcAlphaFactor|DstAlphaFactor|OneMinusDstAlphaFactor|DstColorFactor|OneMinusDstColorFactor|SrcAlphaSaturateFactor|ConstantColorFactor|OneMinusConstantColorFactor|ConstantAlphaFactor|OneMinusConstantAlphaFactor)}
		* @default SrcAlphaFactor
		*/
		this.blendSrc = 204;
		/**
		* Defines the blending destination factor.
		*
		* @type {(ZeroFactor|OneFactor|SrcColorFactor|OneMinusSrcColorFactor|SrcAlphaFactor|OneMinusSrcAlphaFactor|DstAlphaFactor|OneMinusDstAlphaFactor|DstColorFactor|OneMinusDstColorFactor|SrcAlphaSaturateFactor|ConstantColorFactor|OneMinusConstantColorFactor|ConstantAlphaFactor|OneMinusConstantAlphaFactor)}
		* @default OneMinusSrcAlphaFactor
		*/
		this.blendDst = 205;
		/**
		* Defines the blending equation.
		*
		* @type {(AddEquation|SubtractEquation|ReverseSubtractEquation|MinEquation|MaxEquation)}
		* @default AddEquation
		*/
		this.blendEquation = 100;
		/**
		* Defines the blending source alpha factor.
		*
		* @type {?(ZeroFactor|OneFactor|SrcColorFactor|OneMinusSrcColorFactor|SrcAlphaFactor|OneMinusSrcAlphaFactor|DstAlphaFactor|OneMinusDstAlphaFactor|DstColorFactor|OneMinusDstColorFactor|SrcAlphaSaturateFactor|ConstantColorFactor|OneMinusConstantColorFactor|ConstantAlphaFactor|OneMinusConstantAlphaFactor)}
		* @default null
		*/
		this.blendSrcAlpha = null;
		/**
		* Defines the blending destination alpha factor.
		*
		* @type {?(ZeroFactor|OneFactor|SrcColorFactor|OneMinusSrcColorFactor|SrcAlphaFactor|OneMinusSrcAlphaFactor|DstAlphaFactor|OneMinusDstAlphaFactor|DstColorFactor|OneMinusDstColorFactor|SrcAlphaSaturateFactor|ConstantColorFactor|OneMinusConstantColorFactor|ConstantAlphaFactor|OneMinusConstantAlphaFactor)}
		* @default null
		*/
		this.blendDstAlpha = null;
		/**
		* Defines the blending equation of the alpha channel.
		*
		* @type {?(AddEquation|SubtractEquation|ReverseSubtractEquation|MinEquation|MaxEquation)}
		* @default null
		*/
		this.blendEquationAlpha = null;
		/**
		* Represents the RGB values of the constant blend color.
		*
		* This property has only an effect when using custom blending with `ConstantColor` or `OneMinusConstantColor`.
		*
		* @type {Color}
		* @default (0,0,0)
		*/
		this.blendColor = new Color(0, 0, 0);
		/**
		* Represents the alpha value of the constant blend color.
		*
		* This property has only an effect when using custom blending with `ConstantAlpha` or `OneMinusConstantAlpha`.
		*
		* @type {number}
		* @default 0
		*/
		this.blendAlpha = 0;
		/**
		* Defines the depth function.
		*
		* @type {(NeverDepth|AlwaysDepth|LessDepth|LessEqualDepth|EqualDepth|GreaterEqualDepth|GreaterDepth|NotEqualDepth)}
		* @default LessEqualDepth
		*/
		this.depthFunc = 3;
		/**
		* Whether to have depth test enabled when rendering this material.
		* When the depth test is disabled, the depth write will also be implicitly disabled.
		*
		* @type {boolean}
		* @default true
		*/
		this.depthTest = true;
		/**
		* Whether rendering this material has any effect on the depth buffer.
		*
		* When drawing 2D overlays it can be useful to disable the depth writing in
		* order to layer several things together without creating z-index artifacts.
		*
		* @type {boolean}
		* @default true
		*/
		this.depthWrite = true;
		/**
		* The bit mask to use when writing to the stencil buffer.
		*
		* @type {number}
		* @default 0xff
		*/
		this.stencilWriteMask = 255;
		/**
		* The stencil comparison function to use.
		*
		* @type {NeverStencilFunc|LessStencilFunc|EqualStencilFunc|LessEqualStencilFunc|GreaterStencilFunc|NotEqualStencilFunc|GreaterEqualStencilFunc|AlwaysStencilFunc}
		* @default AlwaysStencilFunc
		*/
		this.stencilFunc = 519;
		/**
		* The value to use when performing stencil comparisons or stencil operations.
		*
		* @type {number}
		* @default 0
		*/
		this.stencilRef = 0;
		/**
		* The bit mask to use when comparing against the stencil buffer.
		*
		* @type {number}
		* @default 0xff
		*/
		this.stencilFuncMask = 255;
		/**
		* Which stencil operation to perform when the comparison function returns `false`.
		*
		* @type {ZeroStencilOp|KeepStencilOp|ReplaceStencilOp|IncrementStencilOp|DecrementStencilOp|IncrementWrapStencilOp|DecrementWrapStencilOp|InvertStencilOp}
		* @default KeepStencilOp
		*/
		this.stencilFail = KeepStencilOp;
		/**
		* Which stencil operation to perform when the comparison function returns
		* `true` but the depth test fails.
		*
		* @type {ZeroStencilOp|KeepStencilOp|ReplaceStencilOp|IncrementStencilOp|DecrementStencilOp|IncrementWrapStencilOp|DecrementWrapStencilOp|InvertStencilOp}
		* @default KeepStencilOp
		*/
		this.stencilZFail = KeepStencilOp;
		/**
		* Which stencil operation to perform when the comparison function returns
		* `true` and the depth test passes.
		*
		* @type {ZeroStencilOp|KeepStencilOp|ReplaceStencilOp|IncrementStencilOp|DecrementStencilOp|IncrementWrapStencilOp|DecrementWrapStencilOp|InvertStencilOp}
		* @default KeepStencilOp
		*/
		this.stencilZPass = KeepStencilOp;
		/**
		* Whether stencil operations are performed against the stencil buffer. In
		* order to perform writes or comparisons against the stencil buffer this
		* value must be `true`.
		*
		* @type {boolean}
		* @default false
		*/
		this.stencilWrite = false;
		/**
		* User-defined clipping planes specified as THREE.Plane objects in world
		* space. These planes apply to the objects this material is attached to.
		* Points in space whose signed distance to the plane is negative are clipped
		* (not rendered). This requires {@link WebGLRenderer#localClippingEnabled} to
		* be `true`.
		*
		* @type {?Array<Plane>}
		* @default null
		*/
		this.clippingPlanes = null;
		/**
		* Changes the behavior of clipping planes so that only their intersection is
		* clipped, rather than their union.
		*
		* @type {boolean}
		* @default false
		*/
		this.clipIntersection = false;
		/**
		* Defines whether to clip shadows according to the clipping planes specified
		* on this material.
		*
		* @type {boolean}
		* @default false
		*/
		this.clipShadows = false;
		/**
		* Defines which side of faces cast shadows. If `null`, the side casting shadows
		* is determined as follows:
		*
		* - When {@link Material#side} is set to `FrontSide`, the back side cast shadows.
		* - When {@link Material#side} is set to `BackSide`, the front side cast shadows.
		* - When {@link Material#side} is set to `DoubleSide`, both sides cast shadows.
		*
		* @type {?(FrontSide|BackSide|DoubleSide)}
		* @default null
		*/
		this.shadowSide = null;
		/**
		* Whether to render the material's color.
		*
		* This can be used in conjunction with {@link Object3D#renderOder} to create invisible
		* objects that occlude other objects.
		*
		* @type {boolean}
		* @default true
		*/
		this.colorWrite = true;
		/**
		* Override the renderer's default precision for this material.
		*
		* @type {?('highp'|'mediump'|'lowp')}
		* @default null
		*/
		this.precision = null;
		/**
		* Whether to use polygon offset or not. When enabled, each fragment's depth value will
		* be offset after it is interpolated from the depth values of the appropriate vertices.
		* The offset is added before the depth test is performed and before the value is written
		* into the depth buffer.
		*
		* Can be useful for rendering hidden-line images, for applying decals to surfaces, and for
		* rendering solids with highlighted edges.
		*
		* @type {boolean}
		* @default false
		*/
		this.polygonOffset = false;
		/**
		* Specifies a scale factor that is used to create a variable depth offset for each polygon.
		*
		* @type {number}
		* @default 0
		*/
		this.polygonOffsetFactor = 0;
		/**
		* Is multiplied by an implementation-specific value to create a constant depth offset.
		*
		* @type {number}
		* @default 0
		*/
		this.polygonOffsetUnits = 0;
		/**
		* Whether to apply dithering to the color to remove the appearance of banding.
		*
		* @type {boolean}
		* @default false
		*/
		this.dithering = false;
		/**
		* Whether alpha to coverage should be enabled or not. Can only be used with MSAA-enabled contexts
		* (meaning when the renderer was created with *antialias* parameter set to `true`). Enabling this
		* will smooth aliasing on clip plane edges and alphaTest-clipped edges.
		*
		* @type {boolean}
		* @default false
		*/
		this.alphaToCoverage = false;
		/**
		* Whether to premultiply the alpha (transparency) value.
		*
		* @type {boolean}
		* @default false
		*/
		this.premultipliedAlpha = false;
		/**
		* Whether double-sided, transparent objects should be rendered with a single pass or not.
		*
		* The engine renders double-sided, transparent objects with two draw calls (back faces first,
		* then front faces) to mitigate transparency artifacts. There are scenarios however where this
		* approach produces no quality gains but still doubles draw calls e.g. when rendering flat
		* vegetation like grass sprites. In these cases, set the `forceSinglePass` flag to `true` to
		* disable the two pass rendering to avoid performance issues.
		*
		* @type {boolean}
		* @default false
		*/
		this.forceSinglePass = false;
		/**
		* Whether it's possible to override the material with {@link Scene#overrideMaterial} or not.
		*
		* @type {boolean}
		* @default true
		*/
		this.allowOverride = true;
		/**
		* Defines whether 3D objects using this material are visible.
		*
		* @type {boolean}
		* @default true
		*/
		this.visible = true;
		/**
		* Defines whether this material is tone mapped according to the renderer's tone mapping setting.
		*
		* It is ignored when rendering to a render target or using post processing or when using
		* `WebGPURenderer`. In all these cases, all materials are honored by tone mapping.
		*
		* @type {boolean}
		* @default true
		*/
		this.toneMapped = true;
		/**
		* An object that can be used to store custom data about the Material. It
		* should not hold references to functions as these will not be cloned.
		*
		* @type {Object}
		*/
		this.userData = {};
		/**
		* This starts at `0` and counts how many times {@link Material#needsUpdate} is set to `true`.
		*
		* @type {number}
		* @readonly
		* @default 0
		*/
		this.version = 0;
		this._alphaTest = 0;
	}
	/**
	* Sets the alpha value to be used when running an alpha test. The material
	* will not be rendered if the opacity is lower than this value.
	*
	* @type {number}
	* @readonly
	* @default 0
	*/
	get alphaTest() {
		return this._alphaTest;
	}
	set alphaTest(value) {
		if (this._alphaTest > 0 !== value > 0) this.version++;
		this._alphaTest = value;
	}
	/**
	* An optional callback that is executed immediately before the material is used to render a 3D object.
	*
	* This method can only be used when rendering with {@link WebGLRenderer}.
	*
	* @param {WebGLRenderer} renderer - The renderer.
	* @param {Scene} scene - The scene.
	* @param {Camera} camera - The camera that is used to render the scene.
	* @param {BufferGeometry} geometry - The 3D object's geometry.
	* @param {Object3D} object - The 3D object.
	* @param {Object} group - The geometry group data.
	*/
	onBeforeRender() {}
	/**
	* An optional callback that is executed immediately before the shader
	* program is compiled. This function is called with the shader source code
	* as a parameter. Useful for the modification of built-in materials.
	*
	* This method can only be used when rendering with {@link WebGLRenderer}. The
	* recommended approach when customizing materials is to use `WebGPURenderer` with the new
	* Node Material system and [TSL](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language).
	*
	* @param {{vertexShader:string,fragmentShader:string,uniforms:Object}} shaderobject - The object holds the uniforms and the vertex and fragment shader source.
	* @param {WebGLRenderer} renderer - A reference to the renderer.
	*/
	onBeforeCompile() {}
	/**
	* In case {@link Material#onBeforeCompile} is used, this callback can be used to identify
	* values of settings used in `onBeforeCompile()`, so three.js can reuse a cached
	* shader or recompile the shader for this material as needed.
	*
	* This method can only be used when rendering with {@link WebGLRenderer}.
	*
	* @return {string} The custom program cache key.
	*/
	customProgramCacheKey() {
		return this.onBeforeCompile.toString();
	}
	/**
	* This method can be used to set default values from parameter objects.
	* It is a generic implementation so it can be used with different types
	* of materials.
	*
	* @param {Object} [values] - The material values to set.
	*/
	setValues(values) {
		if (values === void 0) return;
		for (const key in values) {
			const newValue = values[key];
			if (newValue === void 0) {
				warn(`Material: parameter '${key}' has value of undefined.`);
				continue;
			}
			const currentValue = this[key];
			if (currentValue === void 0) {
				warn(`Material: '${key}' is not a property of THREE.${this.type}.`);
				continue;
			}
			if (currentValue && currentValue.isColor) currentValue.set(newValue);
			else if (currentValue && currentValue.isVector2 && newValue && newValue.isVector2 || currentValue && currentValue.isEuler && newValue && newValue.isEuler || currentValue && currentValue.isVector3 && newValue && newValue.isVector3) currentValue.copy(newValue);
			else this[key] = newValue;
		}
	}
	/**
	* Serializes the material into JSON.
	*
	* @param {?(Object|string)} meta - An optional value holding meta information about the serialization.
	* @return {Object} A JSON object representing the serialized material.
	* @see {@link ObjectLoader#parse}
	*/
	toJSON(meta) {
		const isRootObject = meta === void 0 || typeof meta === "string";
		if (isRootObject) meta = {
			textures: {},
			images: {}
		};
		const data = { metadata: {
			version: 4.7,
			type: "Material",
			generator: "Material.toJSON"
		} };
		data.uuid = this.uuid;
		data.type = this.type;
		if (this.name !== "") data.name = this.name;
		if (this.color && this.color.isColor) data.color = this.color.getHex();
		if (this.roughness !== void 0) data.roughness = this.roughness;
		if (this.metalness !== void 0) data.metalness = this.metalness;
		if (this.sheen !== void 0) data.sheen = this.sheen;
		if (this.sheenColor && this.sheenColor.isColor) data.sheenColor = this.sheenColor.getHex();
		if (this.sheenRoughness !== void 0) data.sheenRoughness = this.sheenRoughness;
		if (this.emissive && this.emissive.isColor) data.emissive = this.emissive.getHex();
		if (this.emissiveIntensity !== void 0 && this.emissiveIntensity !== 1) data.emissiveIntensity = this.emissiveIntensity;
		if (this.specular && this.specular.isColor) data.specular = this.specular.getHex();
		if (this.specularIntensity !== void 0) data.specularIntensity = this.specularIntensity;
		if (this.specularColor && this.specularColor.isColor) data.specularColor = this.specularColor.getHex();
		if (this.shininess !== void 0) data.shininess = this.shininess;
		if (this.clearcoat !== void 0) data.clearcoat = this.clearcoat;
		if (this.clearcoatRoughness !== void 0) data.clearcoatRoughness = this.clearcoatRoughness;
		if (this.clearcoatMap && this.clearcoatMap.isTexture) data.clearcoatMap = this.clearcoatMap.toJSON(meta).uuid;
		if (this.clearcoatRoughnessMap && this.clearcoatRoughnessMap.isTexture) data.clearcoatRoughnessMap = this.clearcoatRoughnessMap.toJSON(meta).uuid;
		if (this.clearcoatNormalMap && this.clearcoatNormalMap.isTexture) {
			data.clearcoatNormalMap = this.clearcoatNormalMap.toJSON(meta).uuid;
			data.clearcoatNormalScale = this.clearcoatNormalScale.toArray();
		}
		if (this.sheenColorMap && this.sheenColorMap.isTexture) data.sheenColorMap = this.sheenColorMap.toJSON(meta).uuid;
		if (this.sheenRoughnessMap && this.sheenRoughnessMap.isTexture) data.sheenRoughnessMap = this.sheenRoughnessMap.toJSON(meta).uuid;
		if (this.dispersion !== void 0) data.dispersion = this.dispersion;
		if (this.iridescence !== void 0) data.iridescence = this.iridescence;
		if (this.iridescenceIOR !== void 0) data.iridescenceIOR = this.iridescenceIOR;
		if (this.iridescenceThicknessRange !== void 0) data.iridescenceThicknessRange = this.iridescenceThicknessRange;
		if (this.iridescenceMap && this.iridescenceMap.isTexture) data.iridescenceMap = this.iridescenceMap.toJSON(meta).uuid;
		if (this.iridescenceThicknessMap && this.iridescenceThicknessMap.isTexture) data.iridescenceThicknessMap = this.iridescenceThicknessMap.toJSON(meta).uuid;
		if (this.anisotropy !== void 0) data.anisotropy = this.anisotropy;
		if (this.anisotropyRotation !== void 0) data.anisotropyRotation = this.anisotropyRotation;
		if (this.anisotropyMap && this.anisotropyMap.isTexture) data.anisotropyMap = this.anisotropyMap.toJSON(meta).uuid;
		if (this.map && this.map.isTexture) data.map = this.map.toJSON(meta).uuid;
		if (this.matcap && this.matcap.isTexture) data.matcap = this.matcap.toJSON(meta).uuid;
		if (this.alphaMap && this.alphaMap.isTexture) data.alphaMap = this.alphaMap.toJSON(meta).uuid;
		if (this.lightMap && this.lightMap.isTexture) {
			data.lightMap = this.lightMap.toJSON(meta).uuid;
			data.lightMapIntensity = this.lightMapIntensity;
		}
		if (this.aoMap && this.aoMap.isTexture) {
			data.aoMap = this.aoMap.toJSON(meta).uuid;
			data.aoMapIntensity = this.aoMapIntensity;
		}
		if (this.bumpMap && this.bumpMap.isTexture) {
			data.bumpMap = this.bumpMap.toJSON(meta).uuid;
			data.bumpScale = this.bumpScale;
		}
		if (this.normalMap && this.normalMap.isTexture) {
			data.normalMap = this.normalMap.toJSON(meta).uuid;
			data.normalMapType = this.normalMapType;
			data.normalScale = this.normalScale.toArray();
		}
		if (this.displacementMap && this.displacementMap.isTexture) {
			data.displacementMap = this.displacementMap.toJSON(meta).uuid;
			data.displacementScale = this.displacementScale;
			data.displacementBias = this.displacementBias;
		}
		if (this.roughnessMap && this.roughnessMap.isTexture) data.roughnessMap = this.roughnessMap.toJSON(meta).uuid;
		if (this.metalnessMap && this.metalnessMap.isTexture) data.metalnessMap = this.metalnessMap.toJSON(meta).uuid;
		if (this.emissiveMap && this.emissiveMap.isTexture) data.emissiveMap = this.emissiveMap.toJSON(meta).uuid;
		if (this.specularMap && this.specularMap.isTexture) data.specularMap = this.specularMap.toJSON(meta).uuid;
		if (this.specularIntensityMap && this.specularIntensityMap.isTexture) data.specularIntensityMap = this.specularIntensityMap.toJSON(meta).uuid;
		if (this.specularColorMap && this.specularColorMap.isTexture) data.specularColorMap = this.specularColorMap.toJSON(meta).uuid;
		if (this.envMap && this.envMap.isTexture) {
			data.envMap = this.envMap.toJSON(meta).uuid;
			if (this.combine !== void 0) data.combine = this.combine;
		}
		if (this.envMapRotation !== void 0) data.envMapRotation = this.envMapRotation.toArray();
		if (this.envMapIntensity !== void 0) data.envMapIntensity = this.envMapIntensity;
		if (this.reflectivity !== void 0) data.reflectivity = this.reflectivity;
		if (this.refractionRatio !== void 0) data.refractionRatio = this.refractionRatio;
		if (this.gradientMap && this.gradientMap.isTexture) data.gradientMap = this.gradientMap.toJSON(meta).uuid;
		if (this.transmission !== void 0) data.transmission = this.transmission;
		if (this.transmissionMap && this.transmissionMap.isTexture) data.transmissionMap = this.transmissionMap.toJSON(meta).uuid;
		if (this.thickness !== void 0) data.thickness = this.thickness;
		if (this.thicknessMap && this.thicknessMap.isTexture) data.thicknessMap = this.thicknessMap.toJSON(meta).uuid;
		if (this.attenuationDistance !== void 0 && this.attenuationDistance !== Infinity) data.attenuationDistance = this.attenuationDistance;
		if (this.attenuationColor !== void 0) data.attenuationColor = this.attenuationColor.getHex();
		if (this.size !== void 0) data.size = this.size;
		if (this.shadowSide !== null) data.shadowSide = this.shadowSide;
		if (this.sizeAttenuation !== void 0) data.sizeAttenuation = this.sizeAttenuation;
		if (this.blending !== 1) data.blending = this.blending;
		if (this.side !== 0) data.side = this.side;
		if (this.vertexColors === true) data.vertexColors = true;
		if (this.opacity < 1) data.opacity = this.opacity;
		if (this.transparent === true) data.transparent = true;
		if (this.blendSrc !== 204) data.blendSrc = this.blendSrc;
		if (this.blendDst !== 205) data.blendDst = this.blendDst;
		if (this.blendEquation !== 100) data.blendEquation = this.blendEquation;
		if (this.blendSrcAlpha !== null) data.blendSrcAlpha = this.blendSrcAlpha;
		if (this.blendDstAlpha !== null) data.blendDstAlpha = this.blendDstAlpha;
		if (this.blendEquationAlpha !== null) data.blendEquationAlpha = this.blendEquationAlpha;
		if (this.blendColor && this.blendColor.isColor) data.blendColor = this.blendColor.getHex();
		if (this.blendAlpha !== 0) data.blendAlpha = this.blendAlpha;
		if (this.depthFunc !== 3) data.depthFunc = this.depthFunc;
		if (this.depthTest === false) data.depthTest = this.depthTest;
		if (this.depthWrite === false) data.depthWrite = this.depthWrite;
		if (this.colorWrite === false) data.colorWrite = this.colorWrite;
		if (this.stencilWriteMask !== 255) data.stencilWriteMask = this.stencilWriteMask;
		if (this.stencilFunc !== 519) data.stencilFunc = this.stencilFunc;
		if (this.stencilRef !== 0) data.stencilRef = this.stencilRef;
		if (this.stencilFuncMask !== 255) data.stencilFuncMask = this.stencilFuncMask;
		if (this.stencilFail !== 7680) data.stencilFail = this.stencilFail;
		if (this.stencilZFail !== 7680) data.stencilZFail = this.stencilZFail;
		if (this.stencilZPass !== 7680) data.stencilZPass = this.stencilZPass;
		if (this.stencilWrite === true) data.stencilWrite = this.stencilWrite;
		if (this.rotation !== void 0 && this.rotation !== 0) data.rotation = this.rotation;
		if (this.polygonOffset === true) data.polygonOffset = true;
		if (this.polygonOffsetFactor !== 0) data.polygonOffsetFactor = this.polygonOffsetFactor;
		if (this.polygonOffsetUnits !== 0) data.polygonOffsetUnits = this.polygonOffsetUnits;
		if (this.linewidth !== void 0 && this.linewidth !== 1) data.linewidth = this.linewidth;
		if (this.dashSize !== void 0) data.dashSize = this.dashSize;
		if (this.gapSize !== void 0) data.gapSize = this.gapSize;
		if (this.scale !== void 0) data.scale = this.scale;
		if (this.dithering === true) data.dithering = true;
		if (this.alphaTest > 0) data.alphaTest = this.alphaTest;
		if (this.alphaHash === true) data.alphaHash = true;
		if (this.alphaToCoverage === true) data.alphaToCoverage = true;
		if (this.premultipliedAlpha === true) data.premultipliedAlpha = true;
		if (this.forceSinglePass === true) data.forceSinglePass = true;
		if (this.allowOverride === false) data.allowOverride = false;
		if (this.wireframe === true) data.wireframe = true;
		if (this.wireframeLinewidth > 1) data.wireframeLinewidth = this.wireframeLinewidth;
		if (this.wireframeLinecap !== "round") data.wireframeLinecap = this.wireframeLinecap;
		if (this.wireframeLinejoin !== "round") data.wireframeLinejoin = this.wireframeLinejoin;
		if (this.flatShading === true) data.flatShading = true;
		if (this.visible === false) data.visible = false;
		if (this.toneMapped === false) data.toneMapped = false;
		if (this.fog === false) data.fog = false;
		if (Object.keys(this.userData).length > 0) data.userData = this.userData;
		function extractFromCache(cache) {
			const values = [];
			for (const key in cache) {
				const data = cache[key];
				delete data.metadata;
				values.push(data);
			}
			return values;
		}
		if (isRootObject) {
			const textures = extractFromCache(meta.textures);
			const images = extractFromCache(meta.images);
			if (textures.length > 0) data.textures = textures;
			if (images.length > 0) data.images = images;
		}
		return data;
	}
	/**
	* Deserializes the material from the given JSON.
	*
	* @param {Object} json - The JSON holding the serialized material.
	* @param {Object<string,Texture>} textures - A dictionary holding textures referenced by the material.
	* @return {Material} A reference to this material.
	*/
	fromJSON(json, textures) {
		if (json.uuid !== void 0) this.uuid = json.uuid;
		if (json.name !== void 0) this.name = json.name;
		if (json.color !== void 0 && this.color !== void 0) this.color.setHex(json.color);
		if (json.roughness !== void 0) this.roughness = json.roughness;
		if (json.metalness !== void 0) this.metalness = json.metalness;
		if (json.sheen !== void 0) this.sheen = json.sheen;
		if (json.sheenColor !== void 0) this.sheenColor = new Color().setHex(json.sheenColor);
		if (json.sheenRoughness !== void 0) this.sheenRoughness = json.sheenRoughness;
		if (json.emissive !== void 0 && this.emissive !== void 0) this.emissive.setHex(json.emissive);
		if (json.specular !== void 0 && this.specular !== void 0) this.specular.setHex(json.specular);
		if (json.specularIntensity !== void 0) this.specularIntensity = json.specularIntensity;
		if (json.specularColor !== void 0 && this.specularColor !== void 0) this.specularColor.setHex(json.specularColor);
		if (json.shininess !== void 0) this.shininess = json.shininess;
		if (json.clearcoat !== void 0) this.clearcoat = json.clearcoat;
		if (json.clearcoatRoughness !== void 0) this.clearcoatRoughness = json.clearcoatRoughness;
		if (json.dispersion !== void 0) this.dispersion = json.dispersion;
		if (json.iridescence !== void 0) this.iridescence = json.iridescence;
		if (json.iridescenceIOR !== void 0) this.iridescenceIOR = json.iridescenceIOR;
		if (json.iridescenceThicknessRange !== void 0) this.iridescenceThicknessRange = json.iridescenceThicknessRange;
		if (json.transmission !== void 0) this.transmission = json.transmission;
		if (json.thickness !== void 0) this.thickness = json.thickness;
		if (json.attenuationDistance !== void 0) this.attenuationDistance = json.attenuationDistance;
		if (json.attenuationColor !== void 0 && this.attenuationColor !== void 0) this.attenuationColor.setHex(json.attenuationColor);
		if (json.anisotropy !== void 0) this.anisotropy = json.anisotropy;
		if (json.anisotropyRotation !== void 0) this.anisotropyRotation = json.anisotropyRotation;
		if (json.fog !== void 0) this.fog = json.fog;
		if (json.flatShading !== void 0) this.flatShading = json.flatShading;
		if (json.blending !== void 0) this.blending = json.blending;
		if (json.combine !== void 0) this.combine = json.combine;
		if (json.side !== void 0) this.side = json.side;
		if (json.shadowSide !== void 0) this.shadowSide = json.shadowSide;
		if (json.opacity !== void 0) this.opacity = json.opacity;
		if (json.transparent !== void 0) this.transparent = json.transparent;
		if (json.alphaTest !== void 0) this.alphaTest = json.alphaTest;
		if (json.alphaHash !== void 0) this.alphaHash = json.alphaHash;
		if (json.depthFunc !== void 0) this.depthFunc = json.depthFunc;
		if (json.depthTest !== void 0) this.depthTest = json.depthTest;
		if (json.depthWrite !== void 0) this.depthWrite = json.depthWrite;
		if (json.colorWrite !== void 0) this.colorWrite = json.colorWrite;
		if (json.blendSrc !== void 0) this.blendSrc = json.blendSrc;
		if (json.blendDst !== void 0) this.blendDst = json.blendDst;
		if (json.blendEquation !== void 0) this.blendEquation = json.blendEquation;
		if (json.blendSrcAlpha !== void 0) this.blendSrcAlpha = json.blendSrcAlpha;
		if (json.blendDstAlpha !== void 0) this.blendDstAlpha = json.blendDstAlpha;
		if (json.blendEquationAlpha !== void 0) this.blendEquationAlpha = json.blendEquationAlpha;
		if (json.blendColor !== void 0 && this.blendColor !== void 0) this.blendColor.setHex(json.blendColor);
		if (json.blendAlpha !== void 0) this.blendAlpha = json.blendAlpha;
		if (json.stencilWriteMask !== void 0) this.stencilWriteMask = json.stencilWriteMask;
		if (json.stencilFunc !== void 0) this.stencilFunc = json.stencilFunc;
		if (json.stencilRef !== void 0) this.stencilRef = json.stencilRef;
		if (json.stencilFuncMask !== void 0) this.stencilFuncMask = json.stencilFuncMask;
		if (json.stencilFail !== void 0) this.stencilFail = json.stencilFail;
		if (json.stencilZFail !== void 0) this.stencilZFail = json.stencilZFail;
		if (json.stencilZPass !== void 0) this.stencilZPass = json.stencilZPass;
		if (json.stencilWrite !== void 0) this.stencilWrite = json.stencilWrite;
		if (json.wireframe !== void 0) this.wireframe = json.wireframe;
		if (json.wireframeLinewidth !== void 0) this.wireframeLinewidth = json.wireframeLinewidth;
		if (json.wireframeLinecap !== void 0) this.wireframeLinecap = json.wireframeLinecap;
		if (json.wireframeLinejoin !== void 0) this.wireframeLinejoin = json.wireframeLinejoin;
		if (json.rotation !== void 0) this.rotation = json.rotation;
		if (json.linewidth !== void 0) this.linewidth = json.linewidth;
		if (json.dashSize !== void 0) this.dashSize = json.dashSize;
		if (json.gapSize !== void 0) this.gapSize = json.gapSize;
		if (json.scale !== void 0) this.scale = json.scale;
		if (json.polygonOffset !== void 0) this.polygonOffset = json.polygonOffset;
		if (json.polygonOffsetFactor !== void 0) this.polygonOffsetFactor = json.polygonOffsetFactor;
		if (json.polygonOffsetUnits !== void 0) this.polygonOffsetUnits = json.polygonOffsetUnits;
		if (json.dithering !== void 0) this.dithering = json.dithering;
		if (json.alphaToCoverage !== void 0) this.alphaToCoverage = json.alphaToCoverage;
		if (json.premultipliedAlpha !== void 0) this.premultipliedAlpha = json.premultipliedAlpha;
		if (json.forceSinglePass !== void 0) this.forceSinglePass = json.forceSinglePass;
		if (json.allowOverride !== void 0) this.allowOverride = json.allowOverride;
		if (json.visible !== void 0) this.visible = json.visible;
		if (json.toneMapped !== void 0) this.toneMapped = json.toneMapped;
		if (json.userData !== void 0) this.userData = json.userData;
		if (json.vertexColors !== void 0) if (typeof json.vertexColors === "number") this.vertexColors = json.vertexColors > 0;
		else this.vertexColors = json.vertexColors;
		if (json.size !== void 0) this.size = json.size;
		if (json.sizeAttenuation !== void 0) this.sizeAttenuation = json.sizeAttenuation;
		if (json.map !== void 0) this.map = textures[json.map] || null;
		if (json.matcap !== void 0) this.matcap = textures[json.matcap] || null;
		if (json.alphaMap !== void 0) this.alphaMap = textures[json.alphaMap] || null;
		if (json.bumpMap !== void 0) this.bumpMap = textures[json.bumpMap] || null;
		if (json.bumpScale !== void 0) this.bumpScale = json.bumpScale;
		if (json.normalMap !== void 0) this.normalMap = textures[json.normalMap] || null;
		if (json.normalMapType !== void 0) this.normalMapType = json.normalMapType;
		if (json.normalScale !== void 0) {
			let normalScale = json.normalScale;
			if (Array.isArray(normalScale) === false) normalScale = [normalScale, normalScale];
			this.normalScale = new Vector2().fromArray(normalScale);
		}
		if (json.displacementMap !== void 0) this.displacementMap = textures[json.displacementMap] || null;
		if (json.displacementScale !== void 0) this.displacementScale = json.displacementScale;
		if (json.displacementBias !== void 0) this.displacementBias = json.displacementBias;
		if (json.roughnessMap !== void 0) this.roughnessMap = textures[json.roughnessMap] || null;
		if (json.metalnessMap !== void 0) this.metalnessMap = textures[json.metalnessMap] || null;
		if (json.emissiveMap !== void 0) this.emissiveMap = textures[json.emissiveMap] || null;
		if (json.emissiveIntensity !== void 0) this.emissiveIntensity = json.emissiveIntensity;
		if (json.specularMap !== void 0) this.specularMap = textures[json.specularMap] || null;
		if (json.specularIntensityMap !== void 0) this.specularIntensityMap = textures[json.specularIntensityMap] || null;
		if (json.specularColorMap !== void 0) this.specularColorMap = textures[json.specularColorMap] || null;
		if (json.envMap !== void 0) this.envMap = textures[json.envMap] || null;
		if (json.envMapRotation !== void 0) this.envMapRotation.fromArray(json.envMapRotation);
		if (json.envMapIntensity !== void 0) this.envMapIntensity = json.envMapIntensity;
		if (json.reflectivity !== void 0) this.reflectivity = json.reflectivity;
		if (json.refractionRatio !== void 0) this.refractionRatio = json.refractionRatio;
		if (json.lightMap !== void 0) this.lightMap = textures[json.lightMap] || null;
		if (json.lightMapIntensity !== void 0) this.lightMapIntensity = json.lightMapIntensity;
		if (json.aoMap !== void 0) this.aoMap = textures[json.aoMap] || null;
		if (json.aoMapIntensity !== void 0) this.aoMapIntensity = json.aoMapIntensity;
		if (json.gradientMap !== void 0) this.gradientMap = textures[json.gradientMap] || null;
		if (json.clearcoatMap !== void 0) this.clearcoatMap = textures[json.clearcoatMap] || null;
		if (json.clearcoatRoughnessMap !== void 0) this.clearcoatRoughnessMap = textures[json.clearcoatRoughnessMap] || null;
		if (json.clearcoatNormalMap !== void 0) this.clearcoatNormalMap = textures[json.clearcoatNormalMap] || null;
		if (json.clearcoatNormalScale !== void 0) this.clearcoatNormalScale = new Vector2().fromArray(json.clearcoatNormalScale);
		if (json.iridescenceMap !== void 0) this.iridescenceMap = textures[json.iridescenceMap] || null;
		if (json.iridescenceThicknessMap !== void 0) this.iridescenceThicknessMap = textures[json.iridescenceThicknessMap] || null;
		if (json.transmissionMap !== void 0) this.transmissionMap = textures[json.transmissionMap] || null;
		if (json.thicknessMap !== void 0) this.thicknessMap = textures[json.thicknessMap] || null;
		if (json.anisotropyMap !== void 0) this.anisotropyMap = textures[json.anisotropyMap] || null;
		if (json.sheenColorMap !== void 0) this.sheenColorMap = textures[json.sheenColorMap] || null;
		if (json.sheenRoughnessMap !== void 0) this.sheenRoughnessMap = textures[json.sheenRoughnessMap] || null;
		return this;
	}
	/**
	* Returns a new material with copied values from this instance.
	*
	* @return {Material} A clone of this instance.
	*/
	clone() {
		return new this.constructor().copy(this);
	}
	/**
	* Copies the values of the given material to this instance.
	*
	* @param {Material} source - The material to copy.
	* @return {Material} A reference to this instance.
	*/
	copy(source) {
		this.name = source.name;
		this.blending = source.blending;
		this.side = source.side;
		this.vertexColors = source.vertexColors;
		this.opacity = source.opacity;
		this.transparent = source.transparent;
		this.blendSrc = source.blendSrc;
		this.blendDst = source.blendDst;
		this.blendEquation = source.blendEquation;
		this.blendSrcAlpha = source.blendSrcAlpha;
		this.blendDstAlpha = source.blendDstAlpha;
		this.blendEquationAlpha = source.blendEquationAlpha;
		this.blendColor.copy(source.blendColor);
		this.blendAlpha = source.blendAlpha;
		this.depthFunc = source.depthFunc;
		this.depthTest = source.depthTest;
		this.depthWrite = source.depthWrite;
		this.stencilWriteMask = source.stencilWriteMask;
		this.stencilFunc = source.stencilFunc;
		this.stencilRef = source.stencilRef;
		this.stencilFuncMask = source.stencilFuncMask;
		this.stencilFail = source.stencilFail;
		this.stencilZFail = source.stencilZFail;
		this.stencilZPass = source.stencilZPass;
		this.stencilWrite = source.stencilWrite;
		const srcPlanes = source.clippingPlanes;
		let dstPlanes = null;
		if (srcPlanes !== null) {
			const n = srcPlanes.length;
			dstPlanes = new Array(n);
			for (let i = 0; i !== n; ++i) dstPlanes[i] = srcPlanes[i].clone();
		}
		this.clippingPlanes = dstPlanes;
		this.clipIntersection = source.clipIntersection;
		this.clipShadows = source.clipShadows;
		this.shadowSide = source.shadowSide;
		this.colorWrite = source.colorWrite;
		this.precision = source.precision;
		this.polygonOffset = source.polygonOffset;
		this.polygonOffsetFactor = source.polygonOffsetFactor;
		this.polygonOffsetUnits = source.polygonOffsetUnits;
		this.dithering = source.dithering;
		this.alphaTest = source.alphaTest;
		this.alphaHash = source.alphaHash;
		this.alphaToCoverage = source.alphaToCoverage;
		this.premultipliedAlpha = source.premultipliedAlpha;
		this.forceSinglePass = source.forceSinglePass;
		this.allowOverride = source.allowOverride;
		this.visible = source.visible;
		this.toneMapped = source.toneMapped;
		this.userData = JSON.parse(JSON.stringify(source.userData));
		return this;
	}
	/**
	* Frees the GPU-related resources allocated by this instance. Call this
	* method whenever this instance is no longer used in your app.
	*
	* @fires Material#dispose
	*/
	dispose() {
		/**
		* Fires when the material has been disposed of.
		*
		* @event Material#dispose
		* @type {Object}
		*/
		this.dispatchEvent({ type: "dispose" });
	}
	/**
	* Setting this property to `true` indicates the engine the material
	* needs to be recompiled.
	*
	* @type {boolean}
	* @default false
	* @param {boolean} value
	*/
	set needsUpdate(value) {
		if (value === true) this.version++;
	}
};
const _vector$7 = /*@__PURE__*/ new Vector3();
const _segCenter = /*@__PURE__*/ new Vector3();
const _segDir = /*@__PURE__*/ new Vector3();
const _diff = /*@__PURE__*/ new Vector3();
const _edge1 = /*@__PURE__*/ new Vector3();
const _edge2 = /*@__PURE__*/ new Vector3();
const _normal$1 = /*@__PURE__*/ new Vector3();
/**
* A ray that emits from an origin in a certain direction. The class is used by
* {@link Raycaster} to assist with raycasting. Raycasting is used for
* mouse picking (working out what objects in the 3D space the mouse is over)
* amongst other things.
*/
var Ray = class {
	/**
	* Constructs a new ray.
	*
	* @param {Vector3} [origin=(0,0,0)] - The origin of the ray.
	* @param {Vector3} [direction=(0,0,-1)] - The (normalized) direction of the ray.
	*/
	constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
		/**
		* The origin of the ray.
		*
		* @type {Vector3}
		*/
		this.origin = origin;
		/**
		* The (normalized) direction of the ray.
		*
		* @type {Vector3}
		*/
		this.direction = direction;
	}
	/**
	* Sets the ray's components by copying the given values.
	*
	* @param {Vector3} origin - The origin.
	* @param {Vector3} direction - The direction.
	* @return {Ray} A reference to this ray.
	*/
	set(origin, direction) {
		this.origin.copy(origin);
		this.direction.copy(direction);
		return this;
	}
	/**
	* Copies the values of the given ray to this instance.
	*
	* @param {Ray} ray - The ray to copy.
	* @return {Ray} A reference to this ray.
	*/
	copy(ray) {
		this.origin.copy(ray.origin);
		this.direction.copy(ray.direction);
		return this;
	}
	/**
	* Returns a vector that is located at a given distance along this ray.
	*
	* @param {number} t - The distance along the ray to retrieve a position for.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {Vector3} A position on the ray.
	*/
	at(t, target) {
		return target.copy(this.origin).addScaledVector(this.direction, t);
	}
	/**
	* Adjusts the direction of the ray to point at the given vector in world space.
	*
	* @param {Vector3} v - The target position.
	* @return {Ray} A reference to this ray.
	*/
	lookAt(v) {
		this.direction.copy(v).sub(this.origin).normalize();
		return this;
	}
	/**
	* Shift the origin of this ray along its direction by the given distance.
	*
	* @param {number} t - The distance along the ray to interpolate.
	* @return {Ray} A reference to this ray.
	*/
	recast(t) {
		this.origin.copy(this.at(t, _vector$7));
		return this;
	}
	/**
	* Returns the point along this ray that is closest to the given point.
	*
	* @param {Vector3} point - A point in 3D space to get the closet location on the ray for.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {Vector3} The closest point on this ray.
	*/
	closestPointToPoint(point, target) {
		target.subVectors(point, this.origin);
		const directionDistance = target.dot(this.direction);
		if (directionDistance < 0) return target.copy(this.origin);
		return target.copy(this.origin).addScaledVector(this.direction, directionDistance);
	}
	/**
	* Returns the distance of the closest approach between this ray and the given point.
	*
	* @param {Vector3} point - A point in 3D space to compute the distance to.
	* @return {number} The distance.
	*/
	distanceToPoint(point) {
		return Math.sqrt(this.distanceSqToPoint(point));
	}
	/**
	* Returns the squared distance of the closest approach between this ray and the given point.
	*
	* @param {Vector3} point - A point in 3D space to compute the distance to.
	* @return {number} The squared distance.
	*/
	distanceSqToPoint(point) {
		const directionDistance = _vector$7.subVectors(point, this.origin).dot(this.direction);
		if (directionDistance < 0) return this.origin.distanceToSquared(point);
		_vector$7.copy(this.origin).addScaledVector(this.direction, directionDistance);
		return _vector$7.distanceToSquared(point);
	}
	/**
	* Returns the squared distance between this ray and the given line segment.
	*
	* @param {Vector3} v0 - The start point of the line segment.
	* @param {Vector3} v1 - The end point of the line segment.
	* @param {Vector3} [optionalPointOnRay] - When provided, it receives the point on this ray that is closest to the segment.
	* @param {Vector3} [optionalPointOnSegment] - When provided, it receives the point on the line segment that is closest to this ray.
	* @return {number} The squared distance.
	*/
	distanceSqToSegment(v0, v1, optionalPointOnRay, optionalPointOnSegment) {
		_segCenter.copy(v0).add(v1).multiplyScalar(.5);
		_segDir.copy(v1).sub(v0).normalize();
		_diff.copy(this.origin).sub(_segCenter);
		const segExtent = v0.distanceTo(v1) * .5;
		const a01 = -this.direction.dot(_segDir);
		const b0 = _diff.dot(this.direction);
		const b1 = -_diff.dot(_segDir);
		const c = _diff.lengthSq();
		const det = Math.abs(1 - a01 * a01);
		let s0, s1, sqrDist, extDet;
		if (det > 0) {
			s0 = a01 * b1 - b0;
			s1 = a01 * b0 - b1;
			extDet = segExtent * det;
			if (s0 >= 0) if (s1 >= -extDet) if (s1 <= extDet) {
				const invDet = 1 / det;
				s0 *= invDet;
				s1 *= invDet;
				sqrDist = s0 * (s0 + a01 * s1 + 2 * b0) + s1 * (a01 * s0 + s1 + 2 * b1) + c;
			} else {
				s1 = segExtent;
				s0 = Math.max(0, -(a01 * s1 + b0));
				sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
			}
			else {
				s1 = -segExtent;
				s0 = Math.max(0, -(a01 * s1 + b0));
				sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
			}
			else if (s1 <= -extDet) {
				s0 = Math.max(0, -(-a01 * segExtent + b0));
				s1 = s0 > 0 ? -segExtent : Math.min(Math.max(-segExtent, -b1), segExtent);
				sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
			} else if (s1 <= extDet) {
				s0 = 0;
				s1 = Math.min(Math.max(-segExtent, -b1), segExtent);
				sqrDist = s1 * (s1 + 2 * b1) + c;
			} else {
				s0 = Math.max(0, -(a01 * segExtent + b0));
				s1 = s0 > 0 ? segExtent : Math.min(Math.max(-segExtent, -b1), segExtent);
				sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
			}
		} else {
			s1 = a01 > 0 ? -segExtent : segExtent;
			s0 = Math.max(0, -(a01 * s1 + b0));
			sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
		}
		if (optionalPointOnRay) optionalPointOnRay.copy(this.origin).addScaledVector(this.direction, s0);
		if (optionalPointOnSegment) optionalPointOnSegment.copy(_segCenter).addScaledVector(_segDir, s1);
		return sqrDist;
	}
	/**
	* Intersects this ray with the given sphere, returning the intersection
	* point or `null` if there is no intersection.
	*
	* @param {Sphere} sphere - The sphere to intersect.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {?Vector3} The intersection point.
	*/
	intersectSphere(sphere, target) {
		_vector$7.subVectors(sphere.center, this.origin);
		const tca = _vector$7.dot(this.direction);
		const d2 = _vector$7.dot(_vector$7) - tca * tca;
		const radius2 = sphere.radius * sphere.radius;
		if (d2 > radius2) return null;
		const thc = Math.sqrt(radius2 - d2);
		const t0 = tca - thc;
		const t1 = tca + thc;
		if (t1 < 0) return null;
		if (t0 < 0) return this.at(t1, target);
		return this.at(t0, target);
	}
	/**
	* Returns `true` if this ray intersects with the given sphere.
	*
	* @param {Sphere} sphere - The sphere to intersect.
	* @return {boolean} Whether this ray intersects with the given sphere or not.
	*/
	intersectsSphere(sphere) {
		if (sphere.radius < 0) return false;
		return this.distanceSqToPoint(sphere.center) <= sphere.radius * sphere.radius;
	}
	/**
	* Computes the distance from the ray's origin to the given plane. Returns `null` if the ray
	* does not intersect with the plane.
	*
	* @param {Plane} plane - The plane to compute the distance to.
	* @return {?number} Whether this ray intersects with the given sphere or not.
	*/
	distanceToPlane(plane) {
		const denominator = plane.normal.dot(this.direction);
		if (denominator === 0) {
			if (plane.distanceToPoint(this.origin) === 0) return 0;
			return null;
		}
		const t = -(this.origin.dot(plane.normal) + plane.constant) / denominator;
		return t >= 0 ? t : null;
	}
	/**
	* Intersects this ray with the given plane, returning the intersection
	* point or `null` if there is no intersection.
	*
	* @param {Plane} plane - The plane to intersect.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {?Vector3} The intersection point.
	*/
	intersectPlane(plane, target) {
		const t = this.distanceToPlane(plane);
		if (t === null) return null;
		return this.at(t, target);
	}
	/**
	* Returns `true` if this ray intersects with the given plane.
	*
	* @param {Plane} plane - The plane to intersect.
	* @return {boolean} Whether this ray intersects with the given plane or not.
	*/
	intersectsPlane(plane) {
		const distToPoint = plane.distanceToPoint(this.origin);
		if (distToPoint === 0) return true;
		if (plane.normal.dot(this.direction) * distToPoint < 0) return true;
		return false;
	}
	/**
	* Intersects this ray with the given bounding box, returning the intersection
	* point or `null` if there is no intersection.
	*
	* @param {Box3} box - The box to intersect.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {?Vector3} The intersection point.
	*/
	intersectBox(box, target) {
		let tmin, tmax, tymin, tymax, tzmin, tzmax;
		const invdirx = 1 / this.direction.x, invdiry = 1 / this.direction.y, invdirz = 1 / this.direction.z;
		const origin = this.origin;
		if (invdirx >= 0) {
			tmin = (box.min.x - origin.x) * invdirx;
			tmax = (box.max.x - origin.x) * invdirx;
		} else {
			tmin = (box.max.x - origin.x) * invdirx;
			tmax = (box.min.x - origin.x) * invdirx;
		}
		if (invdiry >= 0) {
			tymin = (box.min.y - origin.y) * invdiry;
			tymax = (box.max.y - origin.y) * invdiry;
		} else {
			tymin = (box.max.y - origin.y) * invdiry;
			tymax = (box.min.y - origin.y) * invdiry;
		}
		if (tmin > tymax || tymin > tmax) return null;
		if (tymin > tmin || isNaN(tmin)) tmin = tymin;
		if (tymax < tmax || isNaN(tmax)) tmax = tymax;
		if (invdirz >= 0) {
			tzmin = (box.min.z - origin.z) * invdirz;
			tzmax = (box.max.z - origin.z) * invdirz;
		} else {
			tzmin = (box.max.z - origin.z) * invdirz;
			tzmax = (box.min.z - origin.z) * invdirz;
		}
		if (tmin > tzmax || tzmin > tmax) return null;
		if (tzmin > tmin || tmin !== tmin) tmin = tzmin;
		if (tzmax < tmax || tmax !== tmax) tmax = tzmax;
		if (tmax < 0) return null;
		return this.at(tmin >= 0 ? tmin : tmax, target);
	}
	/**
	* Returns `true` if this ray intersects with the given box.
	*
	* @param {Box3} box - The box to intersect.
	* @return {boolean} Whether this ray intersects with the given box or not.
	*/
	intersectsBox(box) {
		return this.intersectBox(box, _vector$7) !== null;
	}
	/**
	* Intersects this ray with the given triangle, returning the intersection
	* point or `null` if there is no intersection.
	*
	* @param {Vector3} a - The first vertex of the triangle.
	* @param {Vector3} b - The second vertex of the triangle.
	* @param {Vector3} c - The third vertex of the triangle.
	* @param {boolean} backfaceCulling - Whether to use backface culling or not.
	* @param {Vector3} target - The target vector that is used to store the method's result.
	* @return {?Vector3} The intersection point.
	*/
	intersectTriangle(a, b, c, backfaceCulling, target) {
		_edge1.subVectors(b, a);
		_edge2.subVectors(c, a);
		_normal$1.crossVectors(_edge1, _edge2);
		let DdN = this.direction.dot(_normal$1);
		let sign;
		if (DdN > 0) {
			if (backfaceCulling) return null;
			sign = 1;
		} else if (DdN < 0) {
			sign = -1;
			DdN = -DdN;
		} else return null;
		_diff.subVectors(this.origin, a);
		const DdQxE2 = sign * this.direction.dot(_edge2.crossVectors(_diff, _edge2));
		if (DdQxE2 < 0) return null;
		const DdE1xQ = sign * this.direction.dot(_edge1.cross(_diff));
		if (DdE1xQ < 0) return null;
		if (DdQxE2 + DdE1xQ > DdN) return null;
		const QdN = -sign * _diff.dot(_normal$1);
		if (QdN < 0) return null;
		return this.at(QdN / DdN, target);
	}
	/**
	* Transforms this ray with the given 4x4 transformation matrix.
	*
	* @param {Matrix4} matrix4 - The transformation matrix.
	* @return {Ray} A reference to this ray.
	*/
	applyMatrix4(matrix4) {
		this.origin.applyMatrix4(matrix4);
		this.direction.transformDirection(matrix4);
		return this;
	}
	/**
	* Returns `true` if this ray is equal with the given one.
	*
	* @param {Ray} ray - The ray to test for equality.
	* @return {boolean} Whether this ray is equal with the given one.
	*/
	equals(ray) {
		return ray.origin.equals(this.origin) && ray.direction.equals(this.direction);
	}
	/**
	* Returns a new ray with copied values from this instance.
	*
	* @return {Ray} A clone of this instance.
	*/
	clone() {
		return new this.constructor().copy(this);
	}
};
/**
* A material for drawing geometries in a simple shaded (flat or wireframe) way.
*
* This material is not affected by lights.
*
* @augments Material
* @demo scenes/material-browser.html#MeshBasicMaterial
*/
var MeshBasicMaterial = class extends Material {
	/**
	* Constructs a new mesh basic material.
	*
	* @param {Object} [parameters] - An object with one or more properties
	* defining the material's appearance. Any property of the material
	* (including any property from inherited materials) can be passed
	* in here. Color values can be passed any type of value accepted
	* by {@link Color#set}.
	*/
	constructor(parameters) {
		super();
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isMeshBasicMaterial = true;
		this.type = "MeshBasicMaterial";
		/**
		* Color of the material.
		*
		* @type {Color}
		* @default (1,1,1)
		*/
		this.color = new Color(16777215);
		/**
		* The color map. May optionally include an alpha channel, typically combined
		* with {@link Material#transparent} or {@link Material#alphaTest}. The texture map
		* color is modulated by the diffuse `color`.
		*
		* `map` represents color data, and the texture must be assigned a
		* {@link Texture#colorSpace}. Most `map` textures set
		* `texture.colorSpace = SRGBColorSpace`.
		*
		* @type {?Texture}
		* @default null
		*/
		this.map = null;
		/**
		* The light map. Requires a second set of UVs.
		*
		* `lightMap` represents pre-baked illuminance data, and the texture must be assigned
		* a {@link Texture#colorSpace}. Most `lightMap` textures set
		* `texture.colorSpace = LinearSRGBColorSpace` and use float-type formats
		* such as `.exr` or `.hdr`.
		*
		* @type {?Texture}
		* @default null
		*/
		this.lightMap = null;
		/**
		* Intensity of the baked light.
		*
		* @type {number}
		* @default 1
		*/
		this.lightMapIntensity = 1;
		/**
		* The red channel of this texture is used as the ambient occlusion map.
		* Requires a second set of UVs.
		*
		* `aoMap` represents non-color data. Any texture assigned must have
		* `texture.colorSpace = NoColorSpace` (default).
		*
		* @type {?Texture}
		* @default null
		*/
		this.aoMap = null;
		/**
		* Intensity of the ambient occlusion effect. Range is `[0,1]`, where `0`
		* disables ambient occlusion. Where intensity is `1` and the AO map's
		* red channel is also `1`, ambient light is fully occluded on a surface.
		*
		* @type {number}
		* @default 1
		*/
		this.aoMapIntensity = 1;
		/**
		* Specular map used by the material.
		*
		* `specularMap` represents color data, and the texture must be assigned a
		* {@link Texture#colorSpace}. Most `specularMap` textures set
		* `texture.colorSpace = SRGBColorSpace`.
		*
		* @type {?Texture}
		* @default null
		*/
		this.specularMap = null;
		/**
		* The alpha map is a grayscale texture that controls the opacity across the
		* surface (black: fully transparent; white: fully opaque).
		*
		* Only the color of the texture is used, ignoring the alpha channel if one
		* exists. For RGB and RGBA textures, the renderer will use the green channel
		* when sampling this texture due to the extra bit of precision provided for
		* green in DXT-compressed and uncompressed RGB 565 formats. Luminance-only and
		* luminance/alpha textures will also still work as expected.
		*
		* `alphaMap` represents non-color data. Any texture assigned must have
		* `texture.colorSpace = NoColorSpace` (default).
		*
		* @type {?Texture}
		* @default null
		*/
		this.alphaMap = null;
		/**
		* The environment map.
		*
		* `envMap` represents luminance data, and the texture must be assigned
		* a {@link Texture#colorSpace}. Most `envMap` textures set
		* `texture.colorSpace = LinearSRGBColorSpace` and use float-type formats
		* such as `.exr` or `.hdr`.
		*
		* @type {?Texture}
		* @default null
		*/
		this.envMap = null;
		/**
		* The rotation of the environment map in radians.
		*
		* @type {Euler}
		* @default (0,0,0)
		*/
		this.envMapRotation = new Euler();
		/**
		* How to combine the result of the surface's color with the environment map, if any.
		*
		* When set to `MixOperation`, the {@link MeshBasicMaterial#reflectivity} is used to
		* blend between the two colors.
		*
		* @type {(MultiplyOperation|MixOperation|AddOperation)}
		* @default MultiplyOperation
		*/
		this.combine = 0;
		/**
		* How much the environment map affects the surface.
		* The valid range is between `0` (no reflections) and `1` (full reflections).
		*
		* @type {number}
		* @default 1
		*/
		this.reflectivity = 1;
		/**
		* The index of refraction (IOR) of air (approximately 1) divided by the
		* index of refraction of the material. It is used with environment mapping
		* modes {@link CubeRefractionMapping} and {@link EquirectangularRefractionMapping}.
		* The refraction ratio should not exceed `1`.
		*
		* @type {number}
		* @default 0.98
		*/
		this.refractionRatio = .98;
		/**
		* Renders the geometry as a wireframe.
		*
		* @type {boolean}
		* @default false
		*/
		this.wireframe = false;
		/**
		* Controls the thickness of the wireframe.
		*
		* Can only be used with {@link SVGRenderer}.
		*
		* @type {number}
		* @default 1
		*/
		this.wireframeLinewidth = 1;
		/**
		* Defines appearance of wireframe ends.
		*
		* Can only be used with {@link SVGRenderer}.
		*
		* @type {('round'|'bevel'|'miter')}
		* @default 'round'
		*/
		this.wireframeLinecap = "round";
		/**
		* Defines appearance of wireframe joints.
		*
		* Can only be used with {@link SVGRenderer}.
		*
		* @type {('round'|'bevel'|'miter')}
		* @default 'round'
		*/
		this.wireframeLinejoin = "round";
		/**
		* Whether the material is affected by fog or not.
		*
		* @type {boolean}
		* @default true
		*/
		this.fog = true;
		this.setValues(parameters);
	}
	copy(source) {
		super.copy(source);
		this.color.copy(source.color);
		this.map = source.map;
		this.lightMap = source.lightMap;
		this.lightMapIntensity = source.lightMapIntensity;
		this.aoMap = source.aoMap;
		this.aoMapIntensity = source.aoMapIntensity;
		this.specularMap = source.specularMap;
		this.alphaMap = source.alphaMap;
		this.envMap = source.envMap;
		this.envMapRotation.copy(source.envMapRotation);
		this.combine = source.combine;
		this.reflectivity = source.reflectivity;
		this.refractionRatio = source.refractionRatio;
		this.wireframe = source.wireframe;
		this.wireframeLinewidth = source.wireframeLinewidth;
		this.wireframeLinecap = source.wireframeLinecap;
		this.wireframeLinejoin = source.wireframeLinejoin;
		this.fog = source.fog;
		return this;
	}
};
const _inverseMatrix$3 = /*@__PURE__*/ new Matrix4();
const _ray$3 = /*@__PURE__*/ new Ray();
const _sphere$6 = /*@__PURE__*/ new Sphere();
const _sphereHitAt = /*@__PURE__*/ new Vector3();
const _vA = /*@__PURE__*/ new Vector3();
const _vB = /*@__PURE__*/ new Vector3();
const _vC = /*@__PURE__*/ new Vector3();
const _tempA = /*@__PURE__*/ new Vector3();
const _morphA = /*@__PURE__*/ new Vector3();
const _intersectionPoint = /*@__PURE__*/ new Vector3();
const _intersectionPointWorld = /*@__PURE__*/ new Vector3();
/**
* Class representing triangular polygon mesh based objects.
*
* ```js
* const geometry = new THREE.BoxGeometry( 1, 1, 1 );
* const material = new THREE.MeshBasicMaterial( { color: 0xffff00 } );
* const mesh = new THREE.Mesh( geometry, material );
* scene.add( mesh );
* ```
*
* @augments Object3D
*/
var Mesh = class extends Object3D {
	/**
	* Constructs a new mesh.
	*
	* @param {BufferGeometry} [geometry] - The mesh geometry.
	* @param {Material|Array<Material>} [material] - The mesh material.
	*/
	constructor(geometry = new BufferGeometry(), material = new MeshBasicMaterial()) {
		super();
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isMesh = true;
		this.type = "Mesh";
		/**
		* The mesh geometry.
		*
		* @type {BufferGeometry}
		*/
		this.geometry = geometry;
		/**
		* The mesh material.
		*
		* @type {Material|Array<Material>}
		* @default MeshBasicMaterial
		*/
		this.material = material;
		/**
		* A dictionary representing the morph targets in the geometry. The key is the
		* morph targets name, the value its attribute index. This member is `undefined`
		* by default and only set when morph targets are detected in the geometry.
		*
		* @type {Object<string,number>|undefined}
		* @default undefined
		*/
		this.morphTargetDictionary = void 0;
		/**
		* An array of weights typically in the range `[0,1]` that specify how much of the morph
		* is applied. This member is `undefined` by default and only set when morph targets are
		* detected in the geometry.
		*
		* @type {Array<number>|undefined}
		* @default undefined
		*/
		this.morphTargetInfluences = void 0;
		/**
		* The number of instances of this mesh.
		* Can only be used with {@link WebGPURenderer}.
		*
		* @type {number}
		* @default 1
		*/
		this.count = 1;
		this.updateMorphTargets();
	}
	copy(source, recursive) {
		super.copy(source, recursive);
		if (source.morphTargetInfluences !== void 0) this.morphTargetInfluences = source.morphTargetInfluences.slice();
		if (source.morphTargetDictionary !== void 0) this.morphTargetDictionary = Object.assign({}, source.morphTargetDictionary);
		this.material = Array.isArray(source.material) ? source.material.slice() : source.material;
		this.geometry = source.geometry;
		return this;
	}
	/**
	* Sets the values of {@link Mesh#morphTargetDictionary} and {@link Mesh#morphTargetInfluences}
	* to make sure existing morph targets can influence this 3D object.
	*/
	updateMorphTargets() {
		const morphAttributes = this.geometry.morphAttributes;
		const keys = Object.keys(morphAttributes);
		if (keys.length > 0) {
			const morphAttribute = morphAttributes[keys[0]];
			if (morphAttribute !== void 0) {
				this.morphTargetInfluences = [];
				this.morphTargetDictionary = {};
				for (let m = 0, ml = morphAttribute.length; m < ml; m++) {
					const name = morphAttribute[m].name || String(m);
					this.morphTargetInfluences.push(0);
					this.morphTargetDictionary[name] = m;
				}
			}
		}
	}
	/**
	* Returns the local-space position of the vertex at the given index, taking into
	* account the current animation state of both morph targets and skinning.
	*
	* @param {number} index - The vertex index.
	* @param {Vector3} target - The target object that is used to store the method's result.
	* @return {Vector3} The vertex position in local space.
	*/
	getVertexPosition(index, target) {
		const geometry = this.geometry;
		const position = geometry.attributes.position;
		const morphPosition = geometry.morphAttributes.position;
		const morphTargetsRelative = geometry.morphTargetsRelative;
		target.fromBufferAttribute(position, index);
		const morphInfluences = this.morphTargetInfluences;
		if (morphPosition && morphInfluences) {
			_morphA.set(0, 0, 0);
			for (let i = 0, il = morphPosition.length; i < il; i++) {
				const influence = morphInfluences[i];
				const morphAttribute = morphPosition[i];
				if (influence === 0) continue;
				_tempA.fromBufferAttribute(morphAttribute, index);
				if (morphTargetsRelative) _morphA.addScaledVector(_tempA, influence);
				else _morphA.addScaledVector(_tempA.sub(target), influence);
			}
			target.add(_morphA);
		}
		return target;
	}
	/**
	* Computes intersection points between a casted ray and this line.
	*
	* @param {Raycaster} raycaster - The raycaster.
	* @param {Array<Object>} intersects - The target array that holds the intersection points.
	*/
	raycast(raycaster, intersects) {
		const geometry = this.geometry;
		const material = this.material;
		const matrixWorld = this.matrixWorld;
		if (material === void 0) return;
		if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
		_sphere$6.copy(geometry.boundingSphere);
		_sphere$6.applyMatrix4(matrixWorld);
		_ray$3.copy(raycaster.ray).recast(raycaster.near);
		if (_sphere$6.containsPoint(_ray$3.origin) === false) {
			if (_ray$3.intersectSphere(_sphere$6, _sphereHitAt) === null) return;
			if (_ray$3.origin.distanceToSquared(_sphereHitAt) > (raycaster.far - raycaster.near) ** 2) return;
		}
		_inverseMatrix$3.copy(matrixWorld).invert();
		_ray$3.copy(raycaster.ray).applyMatrix4(_inverseMatrix$3);
		if (geometry.boundingBox !== null) {
			if (_ray$3.intersectsBox(geometry.boundingBox) === false) return;
		}
		this._computeIntersections(raycaster, intersects, _ray$3);
	}
	_computeIntersections(raycaster, intersects, rayLocalSpace) {
		let intersection;
		const geometry = this.geometry;
		const material = this.material;
		const index = geometry.index;
		const position = geometry.attributes.position;
		const uv = geometry.attributes.uv;
		const uv1 = geometry.attributes.uv1;
		const normal = geometry.attributes.normal;
		const groups = geometry.groups;
		const drawRange = geometry.drawRange;
		if (index !== null) if (Array.isArray(material)) for (let i = 0, il = groups.length; i < il; i++) {
			const group = groups[i];
			const groupMaterial = material[group.materialIndex];
			const start = Math.max(group.start, drawRange.start);
			const end = Math.min(index.count, Math.min(group.start + group.count, drawRange.start + drawRange.count));
			for (let j = start, jl = end; j < jl; j += 3) {
				const a = index.getX(j);
				const b = index.getX(j + 1);
				const c = index.getX(j + 2);
				intersection = checkGeometryIntersection(this, groupMaterial, raycaster, rayLocalSpace, uv, uv1, normal, a, b, c);
				if (intersection) {
					intersection.faceIndex = Math.floor(j / 3);
					intersection.face.materialIndex = group.materialIndex;
					intersects.push(intersection);
				}
			}
		}
		else {
			const start = Math.max(0, drawRange.start);
			const end = Math.min(index.count, drawRange.start + drawRange.count);
			for (let i = start, il = end; i < il; i += 3) {
				const a = index.getX(i);
				const b = index.getX(i + 1);
				const c = index.getX(i + 2);
				intersection = checkGeometryIntersection(this, material, raycaster, rayLocalSpace, uv, uv1, normal, a, b, c);
				if (intersection) {
					intersection.faceIndex = Math.floor(i / 3);
					intersects.push(intersection);
				}
			}
		}
		else if (position !== void 0) if (Array.isArray(material)) for (let i = 0, il = groups.length; i < il; i++) {
			const group = groups[i];
			const groupMaterial = material[group.materialIndex];
			const start = Math.max(group.start, drawRange.start);
			const end = Math.min(position.count, Math.min(group.start + group.count, drawRange.start + drawRange.count));
			for (let j = start, jl = end; j < jl; j += 3) {
				const a = j;
				const b = j + 1;
				const c = j + 2;
				intersection = checkGeometryIntersection(this, groupMaterial, raycaster, rayLocalSpace, uv, uv1, normal, a, b, c);
				if (intersection) {
					intersection.faceIndex = Math.floor(j / 3);
					intersection.face.materialIndex = group.materialIndex;
					intersects.push(intersection);
				}
			}
		}
		else {
			const start = Math.max(0, drawRange.start);
			const end = Math.min(position.count, drawRange.start + drawRange.count);
			for (let i = start, il = end; i < il; i += 3) {
				const a = i;
				const b = i + 1;
				const c = i + 2;
				intersection = checkGeometryIntersection(this, material, raycaster, rayLocalSpace, uv, uv1, normal, a, b, c);
				if (intersection) {
					intersection.faceIndex = Math.floor(i / 3);
					intersects.push(intersection);
				}
			}
		}
	}
};
function checkIntersection$1(object, material, raycaster, ray, pA, pB, pC, point) {
	let intersect;
	if (material.side === 1) intersect = ray.intersectTriangle(pC, pB, pA, true, point);
	else intersect = ray.intersectTriangle(pA, pB, pC, material.side === 0, point);
	if (intersect === null) return null;
	_intersectionPointWorld.copy(point);
	_intersectionPointWorld.applyMatrix4(object.matrixWorld);
	const distance = raycaster.ray.origin.distanceTo(_intersectionPointWorld);
	if (distance < raycaster.near || distance > raycaster.far) return null;
	return {
		distance,
		point: _intersectionPointWorld.clone(),
		object
	};
}
function checkGeometryIntersection(object, material, raycaster, ray, uv, uv1, normal, a, b, c) {
	object.getVertexPosition(a, _vA);
	object.getVertexPosition(b, _vB);
	object.getVertexPosition(c, _vC);
	const intersection = checkIntersection$1(object, material, raycaster, ray, _vA, _vB, _vC, _intersectionPoint);
	if (intersection) {
		const barycoord = new Vector3();
		Triangle.getBarycoord(_intersectionPoint, _vA, _vB, _vC, barycoord);
		if (uv) intersection.uv = Triangle.getInterpolatedAttribute(uv, a, b, c, barycoord, new Vector2());
		if (uv1) intersection.uv1 = Triangle.getInterpolatedAttribute(uv1, a, b, c, barycoord, new Vector2());
		if (normal) {
			intersection.normal = Triangle.getInterpolatedAttribute(normal, a, b, c, barycoord, new Vector3());
			if (intersection.normal.dot(ray.direction) > 0) intersection.normal.multiplyScalar(-1);
		}
		const face = {
			a,
			b,
			c,
			normal: new Vector3(),
			materialIndex: 0
		};
		Triangle.getNormal(_vA, _vB, _vC, face.normal);
		intersection.face = face;
		intersection.barycoord = barycoord;
	}
	return intersection;
}
/**
* Creates a texture directly from raw buffer data.
*
* The interpretation of the data depends on type and format: If the type is
* `UnsignedByteType`, a `Uint8Array` will be useful for addressing the
* texel data. If the format is `RGBAFormat`, data needs four values for
* one texel; Red, Green, Blue and Alpha (typically the opacity).
*
* @augments Texture
*/
var DataTexture = class extends Texture {
	/**
	* Constructs a new data texture.
	*
	* @param {?TypedArray} [data=null] - The buffer data.
	* @param {number} [width=1] - The width of the texture.
	* @param {number} [height=1] - The height of the texture.
	* @param {number} [format=RGBAFormat] - The texture format.
	* @param {number} [type=UnsignedByteType] - The texture type.
	* @param {number} [mapping=Texture.DEFAULT_MAPPING] - The texture mapping.
	* @param {number} [wrapS=ClampToEdgeWrapping] - The wrapS value.
	* @param {number} [wrapT=ClampToEdgeWrapping] - The wrapT value.
	* @param {number} [magFilter=NearestFilter] - The mag filter value.
	* @param {number} [minFilter=NearestFilter] - The min filter value.
	* @param {number} [anisotropy=Texture.DEFAULT_ANISOTROPY] - The anisotropy value.
	* @param {string} [colorSpace=NoColorSpace] - The color space.
	*/
	constructor(data = null, width = 1, height = 1, format, type, mapping, wrapS, wrapT, magFilter = NearestFilter, minFilter = NearestFilter, anisotropy, colorSpace) {
		super(null, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy, colorSpace);
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isDataTexture = true;
		/**
		* The image definition of a data texture.
		*
		* @type {{data:TypedArray,width:number,height:number}}
		*/
		this.image = {
			data,
			width,
			height
		};
		/**
		* Whether to generate mipmaps (if possible) for a texture.
		*
		* Overwritten and set to `false` by default.
		*
		* @type {boolean}
		* @default false
		*/
		this.generateMipmaps = false;
		/**
		* If set to `true`, the texture is flipped along the vertical axis when
		* uploaded to the GPU.
		*
		* Overwritten and set to `false` by default.
		*
		* @type {boolean}
		* @default false
		*/
		this.flipY = false;
		/**
		* Specifies the alignment requirements for the start of each pixel row in memory.
		*
		* Overwritten and set to `1` by default.
		*
		* @type {boolean}
		* @default 1
		*/
		this.unpackAlignment = 1;
	}
};
/**
* A geometry class for a rectangular cuboid with a given width, height, and depth.
* On creation, the cuboid is centred on the origin, with each edge parallel to one
* of the axes.
*
* ```js
* const geometry = new THREE.BoxGeometry( 1, 1, 1 );
* const material = new THREE.MeshBasicMaterial( { color: 0x00ff00 } );
* const cube = new THREE.Mesh( geometry, material );
* scene.add( cube );
* ```
*
* @augments BufferGeometry
* @demo scenes/geometry-browser.html#BoxGeometry
*/
var BoxGeometry = class BoxGeometry extends BufferGeometry {
	/**
	* Constructs a new box geometry.
	*
	* @param {number} [width=1] - The width. That is, the length of the edges parallel to the X axis.
	* @param {number} [height=1] - The height. That is, the length of the edges parallel to the Y axis.
	* @param {number} [depth=1] - The depth. That is, the length of the edges parallel to the Z axis.
	* @param {number} [widthSegments=1] - Number of segmented rectangular faces along the width of the sides.
	* @param {number} [heightSegments=1] - Number of segmented rectangular faces along the height of the sides.
	* @param {number} [depthSegments=1] - Number of segmented rectangular faces along the depth of the sides.
	*/
	constructor(width = 1, height = 1, depth = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1) {
		super();
		this.type = "BoxGeometry";
		/**
		* Holds the constructor parameters that have been
		* used to generate the geometry. Any modification
		* after instantiation does not change the geometry.
		*
		* @type {Object}
		*/
		this.parameters = {
			width,
			height,
			depth,
			widthSegments,
			heightSegments,
			depthSegments
		};
		const scope = this;
		widthSegments = Math.floor(widthSegments);
		heightSegments = Math.floor(heightSegments);
		depthSegments = Math.floor(depthSegments);
		const indices = [];
		const vertices = [];
		const normals = [];
		const uvs = [];
		let numberOfVertices = 0;
		let groupStart = 0;
		buildPlane("z", "y", "x", -1, -1, depth, height, width, depthSegments, heightSegments, 0);
		buildPlane("z", "y", "x", 1, -1, depth, height, -width, depthSegments, heightSegments, 1);
		buildPlane("x", "z", "y", 1, 1, width, depth, height, widthSegments, depthSegments, 2);
		buildPlane("x", "z", "y", 1, -1, width, depth, -height, widthSegments, depthSegments, 3);
		buildPlane("x", "y", "z", 1, -1, width, height, depth, widthSegments, heightSegments, 4);
		buildPlane("x", "y", "z", -1, -1, width, height, -depth, widthSegments, heightSegments, 5);
		this.setIndex(indices);
		this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
		function buildPlane(u, v, w, udir, vdir, width, height, depth, gridX, gridY, materialIndex) {
			const segmentWidth = width / gridX;
			const segmentHeight = height / gridY;
			const widthHalf = width / 2;
			const heightHalf = height / 2;
			const depthHalf = depth / 2;
			const gridX1 = gridX + 1;
			const gridY1 = gridY + 1;
			let vertexCounter = 0;
			let groupCount = 0;
			const vector = new Vector3();
			for (let iy = 0; iy < gridY1; iy++) {
				const y = iy * segmentHeight - heightHalf;
				for (let ix = 0; ix < gridX1; ix++) {
					vector[u] = (ix * segmentWidth - widthHalf) * udir;
					vector[v] = y * vdir;
					vector[w] = depthHalf;
					vertices.push(vector.x, vector.y, vector.z);
					vector[u] = 0;
					vector[v] = 0;
					vector[w] = depth > 0 ? 1 : -1;
					normals.push(vector.x, vector.y, vector.z);
					uvs.push(ix / gridX);
					uvs.push(1 - iy / gridY);
					vertexCounter += 1;
				}
			}
			for (let iy = 0; iy < gridY; iy++) for (let ix = 0; ix < gridX; ix++) {
				const a = numberOfVertices + ix + gridX1 * iy;
				const b = numberOfVertices + ix + gridX1 * (iy + 1);
				const c = numberOfVertices + (ix + 1) + gridX1 * (iy + 1);
				const d = numberOfVertices + (ix + 1) + gridX1 * iy;
				indices.push(a, b, d);
				indices.push(b, c, d);
				groupCount += 6;
			}
			scope.addGroup(groupStart, groupCount, materialIndex);
			groupStart += groupCount;
			numberOfVertices += vertexCounter;
		}
	}
	copy(source) {
		super.copy(source);
		this.parameters = Object.assign({}, source.parameters);
		return this;
	}
	/**
	* Factory method for creating an instance of this class from the given
	* JSON object.
	*
	* @param {Object} data - A JSON object representing the serialized geometry.
	* @return {BoxGeometry} A new instance.
	*/
	static fromJSON(data) {
		return new BoxGeometry(data.width, data.height, data.depth, data.widthSegments, data.heightSegments, data.depthSegments);
	}
};
/**
* Creates meshes with axial symmetry like vases. The lathe rotates around the Y axis.
*
* ```js
* const points = [];
* for ( let i = 0; i < 10; i ++ ) {
* 	points.push( new THREE.Vector2( Math.sin( i * 0.2 ) * 10 + 5, ( i - 5 ) * 2 ) );
* }
* const geometry = new THREE.LatheGeometry( points );
* const material = new THREE.MeshBasicMaterial( { color: 0xffff00 } );
* const lathe = new THREE.Mesh( geometry, material );
* scene.add( lathe );
* ```
*
* @augments BufferGeometry
* @demo scenes/geometry-browser.html#LatheGeometry
*/
var LatheGeometry = class LatheGeometry extends BufferGeometry {
	/**
	* Constructs a new lathe geometry.
	*
	* @param {Array<Vector2|Vector3>} [points] - An array of points in 2D space. The x-coordinate of each point
	* must be greater than zero.
	* @param {number} [segments=12] - The number of circumference segments to generate.
	* @param {number} [phiStart=0] - The starting angle in radians.
	* @param {number} [phiLength=Math.PI*2] - The radian (0 to 2PI) range of the lathed section 2PI is a
	* closed lathe, less than 2PI is a portion.
	*/
	constructor(points = [
		new Vector2(0, -.5),
		new Vector2(.5, 0),
		new Vector2(0, .5)
	], segments = 12, phiStart = 0, phiLength = Math.PI * 2) {
		super();
		this.type = "LatheGeometry";
		/**
		* Holds the constructor parameters that have been
		* used to generate the geometry. Any modification
		* after instantiation does not change the geometry.
		*
		* @type {Object}
		*/
		this.parameters = {
			points,
			segments,
			phiStart,
			phiLength
		};
		segments = Math.floor(segments);
		phiLength = clamp$1(phiLength, 0, Math.PI * 2);
		const indices = [];
		const vertices = [];
		const uvs = [];
		const initNormals = [];
		const normals = [];
		const inverseSegments = 1 / segments;
		const vertex = new Vector3();
		const uv = new Vector2();
		const normal = new Vector3();
		const curNormal = new Vector3();
		const prevNormal = new Vector3();
		let dx = 0;
		let dy = 0;
		for (let j = 0; j <= points.length - 1; j++) switch (j) {
			case 0:
				dx = points[j + 1].x - points[j].x;
				dy = points[j + 1].y - points[j].y;
				normal.x = dy * 1;
				normal.y = -dx;
				normal.z = dy * 0;
				prevNormal.copy(normal);
				normal.normalize();
				initNormals.push(normal.x, normal.y, normal.z);
				break;
			case points.length - 1:
				initNormals.push(prevNormal.x, prevNormal.y, prevNormal.z);
				break;
			default:
				dx = points[j + 1].x - points[j].x;
				dy = points[j + 1].y - points[j].y;
				normal.x = dy * 1;
				normal.y = -dx;
				normal.z = dy * 0;
				curNormal.copy(normal);
				normal.x += prevNormal.x;
				normal.y += prevNormal.y;
				normal.z += prevNormal.z;
				normal.normalize();
				initNormals.push(normal.x, normal.y, normal.z);
				prevNormal.copy(curNormal);
		}
		for (let i = 0; i <= segments; i++) {
			const phi = phiStart + i * inverseSegments * phiLength;
			const sin = Math.sin(phi);
			const cos = Math.cos(phi);
			for (let j = 0; j <= points.length - 1; j++) {
				vertex.x = points[j].x * sin;
				vertex.y = points[j].y;
				vertex.z = points[j].x * cos;
				vertices.push(vertex.x, vertex.y, vertex.z);
				uv.x = i / segments;
				uv.y = j / (points.length - 1);
				uvs.push(uv.x, uv.y);
				const x = initNormals[3 * j + 0] * sin;
				const y = initNormals[3 * j + 1];
				const z = initNormals[3 * j + 0] * cos;
				normals.push(x, y, z);
			}
		}
		for (let i = 0; i < segments; i++) for (let j = 0; j < points.length - 1; j++) {
			const base = j + i * points.length;
			const a = base;
			const b = base + points.length;
			const c = base + points.length + 1;
			const d = base + 1;
			indices.push(a, b, d);
			indices.push(c, d, b);
		}
		this.setIndex(indices);
		this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
	}
	copy(source) {
		super.copy(source);
		this.parameters = Object.assign({}, source.parameters);
		return this;
	}
	/**
	* Factory method for creating an instance of this class from the given
	* JSON object.
	*
	* @param {Object} data - A JSON object representing the serialized geometry.
	* @return {LatheGeometry} A new instance.
	*/
	static fromJSON(data) {
		return new LatheGeometry(data.points, data.segments, data.phiStart, data.phiLength);
	}
};
/**
* A standard physically based material, using Metallic-Roughness workflow.
*
* Physically based rendering (PBR) has recently become the standard in many
* 3D applications, such as [Unity](https://blogs.unity3d.com/2014/10/29/physically-based-shading-in-unity-5-a-primer/),
* [Unreal](https://docs.unrealengine.com/latest/INT/Engine/Rendering/Materials/PhysicallyBased/) and
* [3D Studio Max](http://area.autodesk.com/blogs/the-3ds-max-blog/what039s-new-for-rendering-in-3ds-max-2017).
*
* This approach differs from older approaches in that instead of using
* approximations for the way in which light interacts with a surface, a
* physically correct model is used. The idea is that, instead of tweaking
* materials to look good under specific lighting, a material can be created
* that will react 'correctly' under all lighting scenarios.
*
* In practice this gives a more accurate and realistic looking result than
* the {@link MeshLambertMaterial} or {@link MeshPhongMaterial}, at the cost of
* being somewhat more computationally expensive. `MeshStandardMaterial` uses per-fragment
* shading.
*
* Note that for best results you should always specify an environment map when using this material.
*
* For a non-technical introduction to the concept of PBR and how to set up a
* PBR material, check out these articles by the people at [marmoset](https://www.marmoset.co):
*
* - [Basic Theory of Physically Based Rendering](https://www.marmoset.co/posts/basic-theory-of-physically-based-rendering/)
* - [Physically Based Rendering and You Can Too](https://www.marmoset.co/posts/physically-based-rendering-and-you-can-too/)
*
* Technical details of the approach used in three.js (and most other PBR systems) can be found is this
* [paper from Disney](https://media.disneyanimation.com/uploads/production/publication_asset/48/asset/s2012_pbs_disney_brdf_notes_v3.pdf)
* (pdf), by Brent Burley.
*
* @augments Material
* @demo scenes/material-browser.html#MeshStandardMaterial
*/
var MeshStandardMaterial = class extends Material {
	/**
	* Constructs a new mesh standard material.
	*
	* @param {Object} [parameters] - An object with one or more properties
	* defining the material's appearance. Any property of the material
	* (including any property from inherited materials) can be passed
	* in here. Color values can be passed any type of value accepted
	* by {@link Color#set}.
	*/
	constructor(parameters) {
		super();
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isMeshStandardMaterial = true;
		this.type = "MeshStandardMaterial";
		this.defines = { "STANDARD": "" };
		/**
		* Color of the material.
		*
		* @type {Color}
		* @default (1,1,1)
		*/
		this.color = new Color(16777215);
		/**
		* How rough the material appears. `0.0` means a smooth mirror reflection, `1.0`
		* means fully diffuse. If `roughnessMap` is also provided,
		* both values are multiplied.
		*
		* @type {number}
		* @default 1
		*/
		this.roughness = 1;
		/**
		* How much the material is like a metal. Non-metallic materials such as wood
		* or stone use `0.0`, metallic use `1.0`, with nothing (usually) in between.
		* A value between `0.0` and `1.0` could be used for a rusty metal look.
		* If `metalnessMap` is also provided, both values are multiplied.
		*
		* @type {number}
		* @default 0
		*/
		this.metalness = 0;
		/**
		* The color map. May optionally include an alpha channel, typically combined
		* with {@link Material#transparent} or {@link Material#alphaTest}. The texture map
		* color is modulated by the diffuse `color`.
		*
		* `map` represents color data, and the texture must be assigned a
		* {@link Texture#colorSpace}. Most `map` textures set
		* `texture.colorSpace = SRGBColorSpace`.
		*
		* @type {?Texture}
		* @default null
		*/
		this.map = null;
		/**
		* The light map. Requires a second set of UVs.
		*
		* `lightMap` represents pre-baked illuminance data, and the texture must be assigned
		* a {@link Texture#colorSpace}. Most `lightMap` textures set
		* `texture.colorSpace = LinearSRGBColorSpace` and use float-type formats
		* such as `.exr` or `.hdr`.
		*
		* @type {?Texture}
		* @default null
		*/
		this.lightMap = null;
		/**
		* Intensity of the baked light.
		*
		* @type {number}
		* @default 1
		*/
		this.lightMapIntensity = 1;
		/**
		* The red channel of this texture is used as the ambient occlusion map.
		* Requires a second set of UVs.
		*
		* `aoMap` represents non-color data. Any texture assigned must have
		* `texture.colorSpace = NoColorSpace` (default).
		*
		* @type {?Texture}
		* @default null
		*/
		this.aoMap = null;
		/**
		* Intensity of the ambient occlusion effect. Range is `[0,1]`, where `0`
		* disables ambient occlusion. Where intensity is `1` and the AO map's
		* red channel is also `1`, ambient light is fully occluded on a surface.
		*
		* @type {number}
		* @default 1
		*/
		this.aoMapIntensity = 1;
		/**
		* Emissive (light) color of the material, essentially a solid color
		* unaffected by other lighting.
		*
		* @type {Color}
		* @default (0,0,0)
		*/
		this.emissive = new Color(0);
		/**
		* Intensity of the emissive light. Modulates the emissive color.
		*
		* @type {number}
		* @default 1
		*/
		this.emissiveIntensity = 1;
		/**
		* Set emissive (glow) map. The emissive map color is modulated by the
		* emissive color and the emissive intensity. If you have an emissive map,
		* be sure to set the emissive color to something other than black.
		*
		* `emissiveMap` represents color data, and the texture must be assigned a
		* {@link Texture#colorSpace}. Most `emissiveMap` textures set
		* `texture.colorSpace = SRGBColorSpace`.
		*
		* @type {?Texture}
		* @default null
		*/
		this.emissiveMap = null;
		/**
		* The texture to create a bump map. The black and white values map to the
		* perceived depth in relation to the lights. Bump doesn't actually affect
		* the geometry of the object, only the lighting. If a normal map is defined
		* this will be ignored.
		*
		* `bumpMap` represents non-color data. Any texture assigned must have
		* `texture.colorSpace = NoColorSpace` (default).
		*
		* @type {?Texture}
		* @default null
		*/
		this.bumpMap = null;
		/**
		* How much the bump map affects the material. Typical range is `[0,1]`.
		*
		* @type {number}
		* @default 1
		*/
		this.bumpScale = 1;
		/**
		* The texture to create a normal map. The RGB values affect the surface
		* normal for each pixel fragment and change the way the color is lit. Normal
		* maps do not change the actual shape of the surface, only the lighting. In
		* case the material has a normal map authored using the left handed
		* convention, the `y` component of `normalScale` should be negated to compensate
		* for the different handedness.
		*
		* `normalMap` represents non-color data. Any texture assigned must have
		* `texture.colorSpace = NoColorSpace` (default).
		*
		* @type {?Texture}
		* @default null
		*/
		this.normalMap = null;
		/**
		* The type of normal map.
		*
		* @type {(TangentSpaceNormalMap|ObjectSpaceNormalMap)}
		* @default TangentSpaceNormalMap
		*/
		this.normalMapType = 0;
		/**
		* How much the normal map affects the material. Typical value range is `[0,1]`.
		*
		* @type {Vector2}
		* @default (1,1)
		*/
		this.normalScale = new Vector2(1, 1);
		/**
		* The displacement map affects the position of the mesh's vertices. Unlike
		* other maps which only affect the light and shade of the material the
		* displaced vertices can cast shadows, block other objects, and otherwise
		* act as real geometry. The displacement texture is an image where the value
		* of each pixel (white being the highest) is mapped against, and
		* repositions, the vertices of the mesh. For best results, pair a
		* displacement map with a matching normal map, since the renderer can
		* not recompute surface normals from the displaced vertices.
		*
		* `displacementMap` represents non-color data. Any texture assigned must have
		* `texture.colorSpace = NoColorSpace` (default).
		*
		* @type {?Texture}
		* @default null
		*/
		this.displacementMap = null;
		/**
		* How much the displacement map affects the mesh (where black is no
		* displacement, and white is maximum displacement). Without a displacement
		* map set, this value is not applied.
		*
		* @type {number}
		* @default 0
		*/
		this.displacementScale = 1;
		/**
		* The offset of the displacement map's values on the mesh's vertices.
		* The bias is added to the scaled sample of the displacement map.
		* Without a displacement map set, this value is not applied.
		*
		* @type {number}
		* @default 0
		*/
		this.displacementBias = 0;
		/**
		* The green channel of this texture is used to alter the roughness of the
		* material.
		*
		* `roughnessMap` represents non-color data. Any texture assigned must have
		* `texture.colorSpace = NoColorSpace` (default).
		*
		* @type {?Texture}
		* @default null
		*/
		this.roughnessMap = null;
		/**
		* The blue channel of this texture is used to alter the metalness of the
		* material.
		*
		* `metalnessMap` represents non-color data. Any texture assigned must have
		* `texture.colorSpace = NoColorSpace` (default).
		*
		* @type {?Texture}
		* @default null
		*/
		this.metalnessMap = null;
		/**
		* The alpha map is a grayscale texture that controls the opacity across the
		* surface (black: fully transparent; white: fully opaque).
		*
		* Only the color of the texture is used, ignoring the alpha channel if one
		* exists. For RGB and RGBA textures, the renderer will use the green channel
		* when sampling this texture due to the extra bit of precision provided for
		* green in DXT-compressed and uncompressed RGB 565 formats. Luminance-only and
		* luminance/alpha textures will also still work as expected.
		*
		* `alphaMap` represents non-color data. Any texture assigned must have
		* `texture.colorSpace = NoColorSpace` (default).
		*
		* @type {?Texture}
		* @default null
		*/
		this.alphaMap = null;
		/**
		* The environment map. To ensure a physically correct rendering, environment maps
		* are internally pre-processed with {@link PMREMGenerator}.
		*
		* `envMap` represents luminance data, and the texture must be assigned
		* a {@link Texture#colorSpace}. Most `envMap` textures set
		* `texture.colorSpace = LinearSRGBColorSpace` and use float-type formats
		* such as `.exr` or `.hdr`.
		*
		* @type {?Texture}
		* @default null
		*/
		this.envMap = null;
		/**
		* The rotation of the environment map in radians.
		*
		* @type {Euler}
		* @default (0,0,0)
		*/
		this.envMapRotation = new Euler();
		/**
		* Scales the effect of the environment map by multiplying its color.
		*
		* @type {number}
		* @default 1
		*/
		this.envMapIntensity = 1;
		/**
		* Renders the geometry as a wireframe.
		*
		* @type {boolean}
		* @default false
		*/
		this.wireframe = false;
		/**
		* Controls the thickness of the wireframe.
		*
		* Can only be used with {@link SVGRenderer}.
		*
		* @type {number}
		* @default 1
		*/
		this.wireframeLinewidth = 1;
		/**
		* Defines appearance of wireframe ends.
		*
		* Can only be used with {@link SVGRenderer}.
		*
		* @type {('round'|'bevel'|'miter')}
		* @default 'round'
		*/
		this.wireframeLinecap = "round";
		/**
		* Defines appearance of wireframe joints.
		*
		* Can only be used with {@link SVGRenderer}.
		*
		* @type {('round'|'bevel'|'miter')}
		* @default 'round'
		*/
		this.wireframeLinejoin = "round";
		/**
		* Whether the material is rendered with flat shading or not.
		*
		* @type {boolean}
		* @default false
		*/
		this.flatShading = false;
		/**
		* Whether the material is affected by fog or not.
		*
		* @type {boolean}
		* @default true
		*/
		this.fog = true;
		this.setValues(parameters);
	}
	copy(source) {
		super.copy(source);
		this.defines = { "STANDARD": "" };
		this.color.copy(source.color);
		this.roughness = source.roughness;
		this.metalness = source.metalness;
		this.map = source.map;
		this.lightMap = source.lightMap;
		this.lightMapIntensity = source.lightMapIntensity;
		this.aoMap = source.aoMap;
		this.aoMapIntensity = source.aoMapIntensity;
		this.emissive.copy(source.emissive);
		this.emissiveMap = source.emissiveMap;
		this.emissiveIntensity = source.emissiveIntensity;
		this.bumpMap = source.bumpMap;
		this.bumpScale = source.bumpScale;
		this.normalMap = source.normalMap;
		this.normalMapType = source.normalMapType;
		this.normalScale.copy(source.normalScale);
		this.displacementMap = source.displacementMap;
		this.displacementScale = source.displacementScale;
		this.displacementBias = source.displacementBias;
		this.roughnessMap = source.roughnessMap;
		this.metalnessMap = source.metalnessMap;
		this.alphaMap = source.alphaMap;
		this.envMap = source.envMap;
		this.envMapRotation.copy(source.envMapRotation);
		this.envMapIntensity = source.envMapIntensity;
		this.wireframe = source.wireframe;
		this.wireframeLinewidth = source.wireframeLinewidth;
		this.wireframeLinecap = source.wireframeLinecap;
		this.wireframeLinejoin = source.wireframeLinejoin;
		this.flatShading = source.flatShading;
		this.fog = source.fog;
		return this;
	}
};
/**
* Converts an array to a specific type.
*
* @param {TypedArray|Array} array - The array to convert.
* @param {TypedArray.constructor} type - The constructor of a typed array that defines the new type.
* @return {TypedArray} The converted array.
*/
function convertArray(array, type) {
	if (!array || array.constructor === type) return array;
	if (typeof type.BYTES_PER_ELEMENT === "number") return new type(array);
	return Array.prototype.slice.call(array);
}
/**
* Abstract base class of interpolants over parametric samples.
*
* The parameter domain is one dimensional, typically the time or a path
* along a curve defined by the data.
*
* The sample values can have any dimensionality and derived classes may
* apply special interpretations to the data.
*
* This class provides the interval seek in a Template Method, deferring
* the actual interpolation to derived classes.
*
* Time complexity is O(1) for linear access crossing at most two points
* and O(log N) for random access, where N is the number of positions.
*
* References: {@link http://www.oodesign.com/template-method-pattern.html}
*
* @abstract
*/
var Interpolant = class {
	/**
	* Constructs a new interpolant.
	*
	* @param {TypedArray} parameterPositions - The parameter positions hold the interpolation factors.
	* @param {TypedArray} sampleValues - The sample values.
	* @param {number} sampleSize - The sample size
	* @param {TypedArray} [resultBuffer] - The result buffer.
	*/
	constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
		/**
		* The parameter positions.
		*
		* @type {TypedArray}
		*/
		this.parameterPositions = parameterPositions;
		/**
		* A cache index.
		*
		* @private
		* @type {number}
		* @default 0
		*/
		this._cachedIndex = 0;
		/**
		* The result buffer.
		*
		* @type {TypedArray}
		*/
		this.resultBuffer = resultBuffer !== void 0 ? resultBuffer : new sampleValues.constructor(sampleSize);
		/**
		* The sample values.
		*
		* @type {TypedArray}
		*/
		this.sampleValues = sampleValues;
		/**
		* The value size.
		*
		* @type {TypedArray}
		*/
		this.valueSize = sampleSize;
		/**
		* The interpolation settings.
		*
		* @type {?Object}
		* @default null
		*/
		this.settings = null;
		/**
		* The default settings object.
		*
		* @type {Object}
		*/
		this.DefaultSettings_ = {};
	}
	/**
	* Evaluate the interpolant at position `t`.
	*
	* @param {number} t - The interpolation factor.
	* @return {TypedArray} The result buffer.
	*/
	evaluate(t) {
		const pp = this.parameterPositions;
		let i1 = this._cachedIndex, t1 = pp[i1], t0 = pp[i1 - 1];
		validate_interval: {
			seek: {
				let right;
				linear_scan: {
					forward_scan: if (!(t < t1)) {
						for (let giveUpAt = i1 + 2;;) {
							if (t1 === void 0) {
								if (t < t0) break forward_scan;
								i1 = pp.length;
								this._cachedIndex = i1;
								return this.copySampleValue_(i1 - 1);
							}
							if (i1 === giveUpAt) break;
							t0 = t1;
							t1 = pp[++i1];
							if (t < t1) break seek;
						}
						right = pp.length;
						break linear_scan;
					}
					if (!(t >= t0)) {
						const t1global = pp[1];
						if (t < t1global) {
							i1 = 2;
							t0 = t1global;
						}
						for (let giveUpAt = i1 - 2;;) {
							if (t0 === void 0) {
								this._cachedIndex = 0;
								return this.copySampleValue_(0);
							}
							if (i1 === giveUpAt) break;
							t1 = t0;
							t0 = pp[--i1 - 1];
							if (t >= t0) break seek;
						}
						right = i1;
						i1 = 0;
						break linear_scan;
					}
					break validate_interval;
				}
				while (i1 < right) {
					const mid = i1 + right >>> 1;
					if (t < pp[mid]) right = mid;
					else i1 = mid + 1;
				}
				t1 = pp[i1];
				t0 = pp[i1 - 1];
				if (t0 === void 0) {
					this._cachedIndex = 0;
					return this.copySampleValue_(0);
				}
				if (t1 === void 0) {
					i1 = pp.length;
					this._cachedIndex = i1;
					return this.copySampleValue_(i1 - 1);
				}
			}
			this._cachedIndex = i1;
			this.intervalChanged_(i1, t0, t1);
		}
		return this.interpolate_(i1, t0, t, t1);
	}
	/**
	* Returns the interpolation settings.
	*
	* @return {Object} The interpolation settings.
	*/
	getSettings_() {
		return this.settings || this.DefaultSettings_;
	}
	/**
	* Copies a sample value to the result buffer.
	*
	* @param {number} index - An index into the sample value buffer.
	* @return {TypedArray} The result buffer.
	*/
	copySampleValue_(index) {
		const result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize, offset = index * stride;
		for (let i = 0; i !== stride; ++i) result[i] = values[offset + i];
		return result;
	}
	/**
	* Copies a sample value to the result buffer.
	*
	* @abstract
	* @param {number} i1 - An index into the sample value buffer.
	* @param {number} t0 - The previous interpolation factor.
	* @param {number} t - The current interpolation factor.
	* @param {number} t1 - The next interpolation factor.
	* @return {TypedArray} The result buffer.
	*/
	interpolate_() {
		throw new Error("THREE.Interpolant: Call to abstract method.");
	}
	/**
	* Optional method that is executed when the interval has changed.
	*
	* @param {number} i1 - An index into the sample value buffer.
	* @param {number} t0 - The previous interpolation factor.
	* @param {number} t - The current interpolation factor.
	*/
	intervalChanged_() {}
};
/**
* Fast and simple cubic spline interpolant.
*
* It was derived from a Hermitian construction setting the first derivative
* at each sample position to the linear slope between neighboring positions
* over their parameter interval.
*
* @augments Interpolant
*/
var CubicInterpolant = class extends Interpolant {
	/**
	* Constructs a new cubic interpolant.
	*
	* @param {TypedArray} parameterPositions - The parameter positions hold the interpolation factors.
	* @param {TypedArray} sampleValues - The sample values.
	* @param {number} sampleSize - The sample size
	* @param {TypedArray} [resultBuffer] - The result buffer.
	*/
	constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
		super(parameterPositions, sampleValues, sampleSize, resultBuffer);
		this._weightPrev = -0;
		this._offsetPrev = -0;
		this._weightNext = -0;
		this._offsetNext = -0;
		this.DefaultSettings_ = {
			endingStart: ZeroCurvatureEnding,
			endingEnd: ZeroCurvatureEnding
		};
	}
	intervalChanged_(i1, t0, t1) {
		const pp = this.parameterPositions;
		let iPrev = i1 - 2, iNext = i1 + 1, tPrev = pp[iPrev], tNext = pp[iNext];
		if (tPrev === void 0) switch (this.getSettings_().endingStart) {
			case ZeroSlopeEnding:
				iPrev = i1;
				tPrev = 2 * t0 - t1;
				break;
			case WrapAroundEnding:
				iPrev = pp.length - 2;
				tPrev = t0 + pp[iPrev] - pp[iPrev + 1];
				break;
			default:
				iPrev = i1;
				tPrev = t1;
		}
		if (tNext === void 0) switch (this.getSettings_().endingEnd) {
			case ZeroSlopeEnding:
				iNext = i1;
				tNext = 2 * t1 - t0;
				break;
			case WrapAroundEnding:
				iNext = 1;
				tNext = t1 + pp[1] - pp[0];
				break;
			default:
				iNext = i1 - 1;
				tNext = t0;
		}
		const halfDt = (t1 - t0) * .5, stride = this.valueSize;
		this._weightPrev = halfDt / (t0 - tPrev);
		this._weightNext = halfDt / (tNext - t1);
		this._offsetPrev = iPrev * stride;
		this._offsetNext = iNext * stride;
	}
	interpolate_(i1, t0, t, t1) {
		const result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize, o1 = i1 * stride, o0 = o1 - stride, oP = this._offsetPrev, oN = this._offsetNext, wP = this._weightPrev, wN = this._weightNext, p = (t - t0) / (t1 - t0), pp = p * p, ppp = pp * p;
		const sP = -wP * ppp + 2 * wP * pp - wP * p;
		const s0 = (1 + wP) * ppp + (-1.5 - 2 * wP) * pp + (-.5 + wP) * p + 1;
		const s1 = (-1 - wN) * ppp + (1.5 + wN) * pp + .5 * p;
		const sN = wN * ppp - wN * pp;
		for (let i = 0; i !== stride; ++i) result[i] = sP * values[oP + i] + s0 * values[o0 + i] + s1 * values[o1 + i] + sN * values[oN + i];
		return result;
	}
};
/**
* A basic linear interpolant.
*
* @augments Interpolant
*/
var LinearInterpolant = class extends Interpolant {
	/**
	* Constructs a new linear interpolant.
	*
	* @param {TypedArray} parameterPositions - The parameter positions hold the interpolation factors.
	* @param {TypedArray} sampleValues - The sample values.
	* @param {number} sampleSize - The sample size
	* @param {TypedArray} [resultBuffer] - The result buffer.
	*/
	constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
		super(parameterPositions, sampleValues, sampleSize, resultBuffer);
	}
	interpolate_(i1, t0, t, t1) {
		const result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize, offset1 = i1 * stride, offset0 = offset1 - stride, weight1 = (t - t0) / (t1 - t0), weight0 = 1 - weight1;
		for (let i = 0; i !== stride; ++i) result[i] = values[offset0 + i] * weight0 + values[offset1 + i] * weight1;
		return result;
	}
};
/**
* Interpolant that evaluates to the sample value at the position preceding
* the parameter.
*
* @augments Interpolant
*/
var DiscreteInterpolant = class extends Interpolant {
	/**
	* Constructs a new discrete interpolant.
	*
	* @param {TypedArray} parameterPositions - The parameter positions hold the interpolation factors.
	* @param {TypedArray} sampleValues - The sample values.
	* @param {number} sampleSize - The sample size
	* @param {TypedArray} [resultBuffer] - The result buffer.
	*/
	constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
		super(parameterPositions, sampleValues, sampleSize, resultBuffer);
	}
	interpolate_(i1) {
		return this.copySampleValue_(i1 - 1);
	}
};
/**
* A Bezier interpolant using cubic Bezier curves with 2D control points.
*
* This interpolant supports the COLLADA/Maya style of Bezier animation where
* each keyframe has explicit in/out tangent control points specified as
* 2D coordinates (time, value).
*
* Tangent data is read from `inTangents` and `outTangents` on the interpolant
* (populated by `KeyframeTrack.InterpolantFactoryMethodBezier`).
*
* For a track with N keyframes and stride S:
* - Each tangent array has N * S * 2 values
* - Layout: [k0_c0_time, k0_c0_value, k0_c1_time, k0_c1_value, ..., k0_cS_time, k0_cS_value,
*            k1_c0_time, k1_c0_value, ...]
*
* @augments Interpolant
*/
var BezierInterpolant = class extends Interpolant {
	interpolate_(i1, t0, t, t1) {
		const result = this.resultBuffer;
		const values = this.sampleValues;
		const stride = this.valueSize;
		const offset1 = i1 * stride;
		const offset0 = offset1 - stride;
		const inTangents = this.inTangents;
		const outTangents = this.outTangents;
		if (!inTangents || !outTangents) {
			const weight1 = (t - t0) / (t1 - t0);
			const weight0 = 1 - weight1;
			for (let i = 0; i !== stride; ++i) result[i] = values[offset0 + i] * weight0 + values[offset1 + i] * weight1;
			return result;
		}
		const tangentStride = stride * 2;
		const i0 = i1 - 1;
		for (let i = 0; i !== stride; ++i) {
			const v0 = values[offset0 + i];
			const v1 = values[offset1 + i];
			const outTangentOffset = i0 * tangentStride + i * 2;
			const c0x = outTangents[outTangentOffset];
			const c0y = outTangents[outTangentOffset + 1];
			const inTangentOffset = i1 * tangentStride + i * 2;
			const c1x = inTangents[inTangentOffset];
			const c1y = inTangents[inTangentOffset + 1];
			let s = (t - t0) / (t1 - t0);
			let s2, s3, oneMinusS, oneMinusS2, oneMinusS3;
			for (let iter = 0; iter < 8; iter++) {
				s2 = s * s;
				s3 = s2 * s;
				oneMinusS = 1 - s;
				oneMinusS2 = oneMinusS * oneMinusS;
				oneMinusS3 = oneMinusS2 * oneMinusS;
				const error = oneMinusS3 * t0 + 3 * oneMinusS2 * s * c0x + 3 * oneMinusS * s2 * c1x + s3 * t1 - t;
				if (Math.abs(error) < 1e-10) break;
				const dbx = 3 * oneMinusS2 * (c0x - t0) + 6 * oneMinusS * s * (c1x - c0x) + 3 * s2 * (t1 - c1x);
				if (Math.abs(dbx) < 1e-10) break;
				s = s - error / dbx;
				s = Math.max(0, Math.min(1, s));
			}
			result[i] = oneMinusS3 * v0 + 3 * oneMinusS2 * s * c0y + 3 * oneMinusS * s2 * c1y + s3 * v1;
		}
		return result;
	}
};
/**
* Represents a timed sequence of keyframes, which are composed of lists of
* times and related values, and which are used to animate a specific property
* of an object.
*/
var KeyframeTrack = class {
	/**
	* Constructs a new keyframe track.
	*
	* @param {string} name - The keyframe track's name.
	* @param {Array<number>} times - A list of keyframe times.
	* @param {Array<number|string|boolean>} values - A list of keyframe values.
	* @param {(InterpolateLinear|InterpolateDiscrete|InterpolateSmooth|InterpolateBezier)} [interpolation] - The interpolation type.
	*/
	constructor(name, times, values, interpolation) {
		if (name === void 0) throw new Error("THREE.KeyframeTrack: track name is undefined");
		if (times === void 0 || times.length === 0) throw new Error("THREE.KeyframeTrack: no keyframes in track named " + name);
		/**
		* The track's name can refer to morph targets or bones or
		* possibly other values within an animated object. See {@link PropertyBinding#parseTrackName}
		* for the forms of strings that can be parsed for property binding.
		*
		* @type {string}
		*/
		this.name = name;
		/**
		* The keyframe times.
		*
		* @type {Float32Array}
		*/
		this.times = convertArray(times, this.TimeBufferType);
		/**
		* The keyframe values.
		*
		* @type {Float32Array}
		*/
		this.values = convertArray(values, this.ValueBufferType);
		this.setInterpolation(interpolation || this.DefaultInterpolation);
	}
	/**
	* Converts the keyframe track to JSON.
	*
	* @static
	* @param {KeyframeTrack} track - The keyframe track to serialize.
	* @return {Object} The serialized keyframe track as JSON.
	*/
	static toJSON(track) {
		const trackType = track.constructor;
		let json;
		if (trackType.toJSON !== this.toJSON) json = trackType.toJSON(track);
		else {
			json = {
				"name": track.name,
				"times": convertArray(track.times, Array),
				"values": convertArray(track.values, Array)
			};
			const interpolation = track.getInterpolation();
			if (interpolation !== track.DefaultInterpolation) json.interpolation = interpolation;
		}
		json.type = track.ValueTypeName;
		return json;
	}
	/**
	* Factory method for creating a new discrete interpolant.
	*
	* @static
	* @param {TypedArray} [result] - The result buffer.
	* @return {DiscreteInterpolant} The new interpolant.
	*/
	InterpolantFactoryMethodDiscrete(result) {
		return new DiscreteInterpolant(this.times, this.values, this.getValueSize(), result);
	}
	/**
	* Factory method for creating a new linear interpolant.
	*
	* @static
	* @param {TypedArray} [result] - The result buffer.
	* @return {LinearInterpolant} The new interpolant.
	*/
	InterpolantFactoryMethodLinear(result) {
		return new LinearInterpolant(this.times, this.values, this.getValueSize(), result);
	}
	/**
	* Factory method for creating a new smooth interpolant.
	*
	* @static
	* @param {TypedArray} [result] - The result buffer.
	* @return {CubicInterpolant} The new interpolant.
	*/
	InterpolantFactoryMethodSmooth(result) {
		return new CubicInterpolant(this.times, this.values, this.getValueSize(), result);
	}
	/**
	* Factory method for creating a new Bezier interpolant.
	*
	* The Bezier interpolant requires tangent data to be set via the `settings` property
	* on the track before creating the interpolant. The settings should contain:
	* - `inTangents`: Float32Array with [time, value] pairs per keyframe per component
	* - `outTangents`: Float32Array with [time, value] pairs per keyframe per component
	*
	* @static
	* @param {TypedArray} [result] - The result buffer.
	* @return {BezierInterpolant} The new interpolant.
	*/
	InterpolantFactoryMethodBezier(result) {
		const interpolant = new BezierInterpolant(this.times, this.values, this.getValueSize(), result);
		if (this.settings) {
			interpolant.inTangents = this.settings.inTangents;
			interpolant.outTangents = this.settings.outTangents;
		}
		return interpolant;
	}
	/**
	* Defines the interpolation factor method for this keyframe track.
	*
	* @param {(InterpolateLinear|InterpolateDiscrete|InterpolateSmooth|InterpolateBezier)} interpolation - The interpolation type.
	* @return {KeyframeTrack} A reference to this keyframe track.
	*/
	setInterpolation(interpolation) {
		let factoryMethod;
		switch (interpolation) {
			case InterpolateDiscrete:
				factoryMethod = this.InterpolantFactoryMethodDiscrete;
				break;
			case InterpolateLinear:
				factoryMethod = this.InterpolantFactoryMethodLinear;
				break;
			case InterpolateSmooth:
				factoryMethod = this.InterpolantFactoryMethodSmooth;
				break;
			case InterpolateBezier: factoryMethod = this.InterpolantFactoryMethodBezier;
		}
		if (factoryMethod === void 0) {
			const message = "unsupported interpolation for " + this.ValueTypeName + " keyframe track named " + this.name;
			if (this.createInterpolant === void 0) if (interpolation !== this.DefaultInterpolation) this.setInterpolation(this.DefaultInterpolation);
			else throw new Error(message);
			warn("KeyframeTrack:", message);
			return this;
		}
		this.createInterpolant = factoryMethod;
		return this;
	}
	/**
	* Returns the current interpolation type.
	*
	* @return {(InterpolateLinear|InterpolateDiscrete|InterpolateSmooth|InterpolateBezier)} The interpolation type.
	*/
	getInterpolation() {
		switch (this.createInterpolant) {
			case this.InterpolantFactoryMethodDiscrete: return InterpolateDiscrete;
			case this.InterpolantFactoryMethodLinear: return InterpolateLinear;
			case this.InterpolantFactoryMethodSmooth: return InterpolateSmooth;
			case this.InterpolantFactoryMethodBezier: return InterpolateBezier;
		}
	}
	/**
	* Returns the value size.
	*
	* @return {number} The value size.
	*/
	getValueSize() {
		return this.values.length / this.times.length;
	}
	/**
	* Moves all keyframes either forward or backward in time.
	*
	* @param {number} timeOffset - The offset to move the time values.
	* @return {KeyframeTrack} A reference to this keyframe track.
	*/
	shift(timeOffset) {
		if (timeOffset !== 0) {
			const times = this.times;
			for (let i = 0, n = times.length; i !== n; ++i) times[i] += timeOffset;
		}
		return this;
	}
	/**
	* Scale all keyframe times by a factor (useful for frame - seconds conversions).
	*
	* @param {number} timeScale - The time scale.
	* @return {KeyframeTrack} A reference to this keyframe track.
	*/
	scale(timeScale) {
		if (timeScale !== 1) {
			const times = this.times;
			for (let i = 0, n = times.length; i !== n; ++i) times[i] *= timeScale;
		}
		return this;
	}
	/**
	* Removes keyframes before and after animation without changing any values within the defined time range.
	*
	* Note: The method does not shift around keys to the start of the track time, because for interpolated
	* keys this will change their values
	*
	* @param {number} startTime - The start time.
	* @param {number} endTime - The end time.
	* @return {KeyframeTrack} A reference to this keyframe track.
	*/
	trim(startTime, endTime) {
		const times = this.times, nKeys = times.length;
		let from = 0, to = nKeys - 1;
		while (from !== nKeys && times[from] < startTime) ++from;
		while (to !== -1 && times[to] > endTime) --to;
		++to;
		if (from !== 0 || to !== nKeys) {
			if (from >= to) {
				to = Math.max(to, 1);
				from = to - 1;
			}
			const stride = this.getValueSize();
			this.times = times.slice(from, to);
			this.values = this.values.slice(from * stride, to * stride);
		}
		return this;
	}
	/**
	* Performs minimal validation on the keyframe track. Returns `true` if the values
	* are valid.
	*
	* @return {boolean} Whether the keyframes are valid or not.
	*/
	validate() {
		let valid = true;
		const valueSize = this.getValueSize();
		if (valueSize - Math.floor(valueSize) !== 0) {
			error("KeyframeTrack: Invalid value size in track.", this);
			valid = false;
		}
		const times = this.times, values = this.values, nKeys = times.length;
		if (nKeys === 0) {
			error("KeyframeTrack: Track is empty.", this);
			valid = false;
		}
		let prevTime = null;
		for (let i = 0; i !== nKeys; i++) {
			const currTime = times[i];
			if (typeof currTime === "number" && isNaN(currTime)) {
				error("KeyframeTrack: Time is not a valid number.", this, i, currTime);
				valid = false;
				break;
			}
			if (prevTime !== null && prevTime > currTime) {
				error("KeyframeTrack: Out of order keys.", this, i, currTime, prevTime);
				valid = false;
				break;
			}
			prevTime = currTime;
		}
		if (values !== void 0) {
			if (isTypedArray(values)) for (let i = 0, n = values.length; i !== n; ++i) {
				const value = values[i];
				if (isNaN(value)) {
					error("KeyframeTrack: Value is not a valid number.", this, i, value);
					valid = false;
					break;
				}
			}
		}
		return valid;
	}
	/**
	* Optimizes this keyframe track by removing equivalent sequential keys (which are
	* common in morph target sequences).
	*
	* @return {KeyframeTrack} A reference to this keyframe track.
	*/
	optimize() {
		const times = this.times.slice(), values = this.values.slice(), stride = this.getValueSize(), smoothInterpolation = this.getInterpolation() === InterpolateSmooth, lastIndex = times.length - 1;
		let writeIndex = 1;
		for (let i = 1; i < lastIndex; ++i) {
			let keep = false;
			const time = times[i];
			if (time !== times[i + 1] && (i !== 1 || time !== times[0])) if (!smoothInterpolation) {
				const offset = i * stride, offsetP = offset - stride, offsetN = offset + stride;
				for (let j = 0; j !== stride; ++j) {
					const value = values[offset + j];
					if (value !== values[offsetP + j] || value !== values[offsetN + j]) {
						keep = true;
						break;
					}
				}
			} else keep = true;
			if (keep) {
				if (i !== writeIndex) {
					times[writeIndex] = times[i];
					const readOffset = i * stride, writeOffset = writeIndex * stride;
					for (let j = 0; j !== stride; ++j) values[writeOffset + j] = values[readOffset + j];
				}
				++writeIndex;
			}
		}
		if (lastIndex > 0) {
			times[writeIndex] = times[lastIndex];
			for (let readOffset = lastIndex * stride, writeOffset = writeIndex * stride, j = 0; j !== stride; ++j) values[writeOffset + j] = values[readOffset + j];
			++writeIndex;
		}
		if (writeIndex !== times.length) {
			this.times = times.slice(0, writeIndex);
			this.values = values.slice(0, writeIndex * stride);
		} else {
			this.times = times;
			this.values = values;
		}
		return this;
	}
	/**
	* Returns a new keyframe track with copied values from this instance.
	*
	* @return {KeyframeTrack} A clone of this instance.
	*/
	clone() {
		const times = this.times.slice();
		const values = this.values.slice();
		const TypedKeyframeTrack = this.constructor;
		const track = new TypedKeyframeTrack(this.name, times, values);
		track.createInterpolant = this.createInterpolant;
		return track;
	}
};
/**
* The value type name.
*
* @type {string}
* @default ''
*/
KeyframeTrack.prototype.ValueTypeName = "";
/**
* The time buffer type of this keyframe track.
*
* @type {TypedArray|Array}
* @default Float32Array.constructor
*/
KeyframeTrack.prototype.TimeBufferType = Float32Array;
/**
* The value buffer type of this keyframe track.
*
* @type {TypedArray|Array}
* @default Float32Array.constructor
*/
KeyframeTrack.prototype.ValueBufferType = Float32Array;
/**
* The default interpolation type of this keyframe track.
*
* @type {(InterpolateLinear|InterpolateDiscrete|InterpolateSmooth|InterpolateBezier)}
* @default InterpolateLinear
*/
KeyframeTrack.prototype.DefaultInterpolation = InterpolateLinear;
/**
* A track for boolean keyframe values.
*
* @augments KeyframeTrack
*/
var BooleanKeyframeTrack = class extends KeyframeTrack {
	/**
	* Constructs a new boolean keyframe track.
	*
	* This keyframe track type has no `interpolation` parameter because the
	* interpolation is always discrete.
	*
	* @param {string} name - The keyframe track's name.
	* @param {Array<number>} times - A list of keyframe times.
	* @param {Array<boolean>} values - A list of keyframe values.
	*/
	constructor(name, times, values) {
		super(name, times, values);
	}
};
/**
* The value type name.
*
* @type {string}
* @default 'bool'
*/
BooleanKeyframeTrack.prototype.ValueTypeName = "bool";
/**
* The value buffer type of this keyframe track.
*
* @type {TypedArray|Array}
* @default Array.constructor
*/
BooleanKeyframeTrack.prototype.ValueBufferType = Array;
/**
* The default interpolation type of this keyframe track.
*
* @type {(InterpolateLinear|InterpolateDiscrete|InterpolateSmooth)}
* @default InterpolateDiscrete
*/
BooleanKeyframeTrack.prototype.DefaultInterpolation = InterpolateDiscrete;
BooleanKeyframeTrack.prototype.InterpolantFactoryMethodLinear = void 0;
BooleanKeyframeTrack.prototype.InterpolantFactoryMethodSmooth = void 0;
/**
* A track for color keyframe values.
*
* @augments KeyframeTrack
*/
var ColorKeyframeTrack = class extends KeyframeTrack {
	/**
	* Constructs a new color keyframe track.
	*
	* @param {string} name - The keyframe track's name.
	* @param {Array<number>} times - A list of keyframe times.
	* @param {Array<number>} values - A list of keyframe values.
	* @param {(InterpolateLinear|InterpolateDiscrete|InterpolateSmooth)} [interpolation] - The interpolation type.
	*/
	constructor(name, times, values, interpolation) {
		super(name, times, values, interpolation);
	}
};
/**
* The value type name.
*
* @type {string}
* @default 'color'
*/
ColorKeyframeTrack.prototype.ValueTypeName = "color";
/**
* A track for numeric keyframe values.
*
* @augments KeyframeTrack
*/
var NumberKeyframeTrack = class extends KeyframeTrack {
	/**
	* Constructs a new number keyframe track.
	*
	* @param {string} name - The keyframe track's name.
	* @param {Array<number>} times - A list of keyframe times.
	* @param {Array<number>} values - A list of keyframe values.
	* @param {(InterpolateLinear|InterpolateDiscrete|InterpolateSmooth)} [interpolation] - The interpolation type.
	*/
	constructor(name, times, values, interpolation) {
		super(name, times, values, interpolation);
	}
};
/**
* The value type name.
*
* @type {string}
* @default 'number'
*/
NumberKeyframeTrack.prototype.ValueTypeName = "number";
/**
* Spherical linear unit quaternion interpolant.
*
* @augments Interpolant
*/
var QuaternionLinearInterpolant = class extends Interpolant {
	/**
	* Constructs a new SLERP interpolant.
	*
	* @param {TypedArray} parameterPositions - The parameter positions hold the interpolation factors.
	* @param {TypedArray} sampleValues - The sample values.
	* @param {number} sampleSize - The sample size
	* @param {TypedArray} [resultBuffer] - The result buffer.
	*/
	constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
		super(parameterPositions, sampleValues, sampleSize, resultBuffer);
	}
	interpolate_(i1, t0, t, t1) {
		const result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize, alpha = (t - t0) / (t1 - t0);
		let offset = i1 * stride;
		for (let end = offset + stride; offset !== end; offset += 4) Quaternion.slerpFlat(result, 0, values, offset - stride, values, offset, alpha);
		return result;
	}
};
/**
* A track for Quaternion keyframe values.
*
* @augments KeyframeTrack
*/
var QuaternionKeyframeTrack = class extends KeyframeTrack {
	/**
	* Constructs a new Quaternion keyframe track.
	*
	* @param {string} name - The keyframe track's name.
	* @param {Array<number>} times - A list of keyframe times.
	* @param {Array<number>} values - A list of keyframe values.
	* @param {(InterpolateLinear|InterpolateDiscrete|InterpolateSmooth)} [interpolation] - The interpolation type.
	*/
	constructor(name, times, values, interpolation) {
		super(name, times, values, interpolation);
	}
	/**
	* Overwritten so the method returns Quaternion based interpolant.
	*
	* @static
	* @param {TypedArray} [result] - The result buffer.
	* @return {QuaternionLinearInterpolant} The new interpolant.
	*/
	InterpolantFactoryMethodLinear(result) {
		return new QuaternionLinearInterpolant(this.times, this.values, this.getValueSize(), result);
	}
};
/**
* The value type name.
*
* @type {string}
* @default 'quaternion'
*/
QuaternionKeyframeTrack.prototype.ValueTypeName = "quaternion";
QuaternionKeyframeTrack.prototype.InterpolantFactoryMethodSmooth = void 0;
/**
* A track for string keyframe values.
*
* @augments KeyframeTrack
*/
var StringKeyframeTrack = class extends KeyframeTrack {
	/**
	* Constructs a new string keyframe track.
	*
	* This keyframe track type has no `interpolation` parameter because the
	* interpolation is always discrete.
	*
	* @param {string} name - The keyframe track's name.
	* @param {Array<number>} times - A list of keyframe times.
	* @param {Array<string>} values - A list of keyframe values.
	*/
	constructor(name, times, values) {
		super(name, times, values);
	}
};
/**
* The value type name.
*
* @type {string}
* @default 'string'
*/
StringKeyframeTrack.prototype.ValueTypeName = "string";
/**
* The value buffer type of this keyframe track.
*
* @type {TypedArray|Array}
* @default Array.constructor
*/
StringKeyframeTrack.prototype.ValueBufferType = Array;
/**
* The default interpolation type of this keyframe track.
*
* @type {(InterpolateLinear|InterpolateDiscrete|InterpolateSmooth)}
* @default InterpolateDiscrete
*/
StringKeyframeTrack.prototype.DefaultInterpolation = InterpolateDiscrete;
StringKeyframeTrack.prototype.InterpolantFactoryMethodLinear = void 0;
StringKeyframeTrack.prototype.InterpolantFactoryMethodSmooth = void 0;
/**
* A track for vector keyframe values.
*
* @augments KeyframeTrack
*/
var VectorKeyframeTrack = class extends KeyframeTrack {
	/**
	* Constructs a new vector keyframe track.
	*
	* @param {string} name - The keyframe track's name.
	* @param {Array<number>} times - A list of keyframe times.
	* @param {Array<number>} values - A list of keyframe values.
	* @param {(InterpolateLinear|InterpolateDiscrete|InterpolateSmooth)} [interpolation] - The interpolation type.
	*/
	constructor(name, times, values, interpolation) {
		super(name, times, values, interpolation);
	}
};
/**
* The value type name.
*
* @type {string}
* @default 'vector'
*/
VectorKeyframeTrack.prototype.ValueTypeName = "vector";
/**
* Handles and keeps track of loaded and pending data. A default global
* instance of this class is created and used by loaders if not supplied
* manually.
*
* In general that should be sufficient, however there are times when it can
* be useful to have separate loaders - for example if you want to show
* separate loading bars for objects and textures.
*
* ```js
* const manager = new THREE.LoadingManager();
* manager.onLoad = () => console.log( 'Loading complete!' );
*
* const loader1 = new OBJLoader( manager );
* const loader2 = new ColladaLoader( manager );
* ```
*/
var LoadingManager = class {
	/**
	* Constructs a new loading manager.
	*
	* @param {Function} [onLoad] - Executes when all items have been loaded.
	* @param {Function} [onProgress] - Executes when single items have been loaded.
	* @param {Function} [onError] - Executes when an error occurs.
	*/
	constructor(onLoad, onProgress, onError) {
		const scope = this;
		let isLoading = false;
		let itemsLoaded = 0;
		let itemsTotal = 0;
		let urlModifier = void 0;
		const handlers = [];
		/**
		* Executes when an item starts loading.
		*
		* @type {Function|undefined}
		* @default undefined
		*/
		this.onStart = void 0;
		/**
		* Executes when all items have been loaded.
		*
		* @type {Function|undefined}
		* @default undefined
		*/
		this.onLoad = onLoad;
		/**
		* Executes when single items have been loaded.
		*
		* @type {Function|undefined}
		* @default undefined
		*/
		this.onProgress = onProgress;
		/**
		* Executes when an error occurs.
		*
		* @type {Function|undefined}
		* @default undefined
		*/
		this.onError = onError;
		/**
		* Used for aborting ongoing requests in loaders using this manager.
		*
		* @private
		* @type {AbortController | null}
		*/
		this._abortController = null;
		/**
		* This should be called by any loader using the manager when the loader
		* starts loading an item.
		*
		* @param {string} url - The URL to load.
		*/
		this.itemStart = function(url) {
			itemsTotal++;
			if (isLoading === false) {
				if (scope.onStart !== void 0) scope.onStart(url, itemsLoaded, itemsTotal);
			}
			isLoading = true;
		};
		/**
		* This should be called by any loader using the manager when the loader
		* ended loading an item.
		*
		* @param {string} url - The URL of the loaded item.
		*/
		this.itemEnd = function(url) {
			itemsLoaded++;
			if (scope.onProgress !== void 0) scope.onProgress(url, itemsLoaded, itemsTotal);
			if (itemsLoaded === itemsTotal) {
				isLoading = false;
				if (scope.onLoad !== void 0) scope.onLoad();
			}
		};
		/**
		* This should be called by any loader using the manager when the loader
		* encounters an error when loading an item.
		*
		* @param {string} url - The URL of the item that produces an error.
		*/
		this.itemError = function(url) {
			if (scope.onError !== void 0) scope.onError(url);
		};
		/**
		* Given a URL, uses the URL modifier callback (if any) and returns a
		* resolved URL. If no URL modifier is set, returns the original URL.
		*
		* @param {string} url - The URL to load.
		* @return {string} The resolved URL.
		*/
		this.resolveURL = function(url) {
			url = url.normalize("NFC");
			if (urlModifier) return urlModifier(url);
			return url;
		};
		/**
		* If provided, the callback will be passed each resource URL before a
		* request is sent. The callback may return the original URL, or a new URL to
		* override loading behavior. This behavior can be used to load assets from
		* .ZIP files, drag-and-drop APIs, and Data URIs.
		*
		* ```js
		* const blobs = {'fish.gltf': blob1, 'diffuse.png': blob2, 'normal.png': blob3};
		*
		* const manager = new THREE.LoadingManager();
		*
		* // Initialize loading manager with URL callback.
		* const objectURLs = [];
		* manager.setURLModifier( ( url ) => {
		*
		* 	url = URL.createObjectURL( blobs[ url ] );
		* 	objectURLs.push( url );
		* 	return url;
		*
		* } );
		*
		* // Load as usual, then revoke the blob URLs.
		* const loader = new GLTFLoader( manager );
		* loader.load( 'fish.gltf', (gltf) => {
		*
		* 	scene.add( gltf.scene );
		* 	objectURLs.forEach( ( url ) => URL.revokeObjectURL( url ) );
		*
		* } );
		* ```
		*
		* @param {function(string):string} transform - URL modifier callback. Called with an URL and must return a resolved URL.
		* @return {LoadingManager} A reference to this loading manager.
		*/
		this.setURLModifier = function(transform) {
			urlModifier = transform;
			return this;
		};
		/**
		* Registers a loader with the given regular expression. Can be used to
		* define what loader should be used in order to load specific files. A
		* typical use case is to overwrite the default loader for textures.
		*
		* ```js
		* // add handler for TGA textures
		* manager.addHandler( /\.tga$/i, new TGALoader() );
		* ```
		*
		* @param {string} regex - A regular expression.
		* @param {Loader} loader - A loader that should handle matched cases.
		* @return {LoadingManager} A reference to this loading manager.
		*/
		this.addHandler = function(regex, loader) {
			handlers.push(regex, loader);
			return this;
		};
		/**
		* Removes the loader for the given regular expression.
		*
		* @param {string} regex - A regular expression.
		* @return {LoadingManager} A reference to this loading manager.
		*/
		this.removeHandler = function(regex) {
			const index = handlers.indexOf(regex);
			if (index !== -1) handlers.splice(index, 2);
			return this;
		};
		/**
		* Can be used to retrieve the registered loader for the given file path.
		*
		* @param {string} file - The file path.
		* @return {?Loader} The registered loader. Returns `null` if no loader was found.
		*/
		this.getHandler = function(file) {
			for (let i = 0, l = handlers.length; i < l; i += 2) {
				const regex = handlers[i];
				const loader = handlers[i + 1];
				if (regex.global) regex.lastIndex = 0;
				if (regex.test(file)) return loader;
			}
			return null;
		};
		/**
		* Can be used to abort ongoing loading requests in loaders using this manager.
		* The abort only works if the loaders implement {@link Loader#abort} and `AbortSignal.any()`
		* is supported in the browser.
		*
		* @return {LoadingManager} A reference to this loading manager.
		*/
		this.abort = function() {
			this.abortController.abort();
			this._abortController = null;
			return this;
		};
	}
	/**
	* Used for aborting ongoing requests in loaders using this manager.
	*
	* @type {AbortController}
	*/
	get abortController() {
		if (!this._abortController) this._abortController = new AbortController();
		return this._abortController;
	}
};
/**
* The global default loading manager.
*
* @constant
* @type {LoadingManager}
*/
const DefaultLoadingManager = /*@__PURE__*/ new LoadingManager();
/**
* Abstract base class for loaders.
*
* @abstract
*/
var Loader = class {
	/**
	* Constructs a new loader.
	*
	* @param {LoadingManager} [manager] - The loading manager.
	*/
	constructor(manager) {
		/**
		* The loading manager.
		*
		* @type {LoadingManager}
		* @default DefaultLoadingManager
		*/
		this.manager = manager !== void 0 ? manager : DefaultLoadingManager;
		/**
		* The crossOrigin string to implement CORS for loading the url from a
		* different domain that allows CORS.
		*
		* @type {string}
		* @default 'anonymous'
		*/
		this.crossOrigin = "anonymous";
		/**
		* Whether the XMLHttpRequest uses credentials.
		*
		* @type {boolean}
		* @default false
		*/
		this.withCredentials = false;
		/**
		* The base path from which the asset will be loaded.
		*
		* @type {string}
		*/
		this.path = "";
		/**
		* The base path from which additional resources like textures will be loaded.
		*
		* @type {string}
		*/
		this.resourcePath = "";
		/**
		* The [request header](https://developer.mozilla.org/en-US/docs/Glossary/Request_header)
		* used in HTTP request.
		*
		* @type {Object<string, any>}
		*/
		this.requestHeader = {};
		if (typeof __THREE_DEVTOOLS__ !== "undefined") __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe", { detail: this }));
	}
	/**
	* This method needs to be implemented by all concrete loaders. It holds the
	* logic for loading assets from the backend.
	*
	* @abstract
	* @param {string} url - The path/URL of the file to be loaded.
	* @param {Function} onLoad - Executed when the loading process has been finished.
	* @param {onProgressCallback} [onProgress] - Executed while the loading is in progress.
	* @param {onErrorCallback} [onError] - Executed when errors occur.
	*/
	load() {}
	/**
	* A async version of {@link Loader#load}.
	*
	* @param {string} url - The path/URL of the file to be loaded.
	* @param {onProgressCallback} [onProgress] - Executed while the loading is in progress.
	* @return {Promise} A Promise that resolves when the asset has been loaded.
	*/
	loadAsync(url, onProgress) {
		const scope = this;
		return new Promise(function(resolve, reject) {
			scope.load(url, resolve, onProgress, reject);
		});
	}
	/**
	* This method needs to be implemented by all concrete loaders. It holds the
	* logic for parsing the asset into three.js entities.
	*
	* @abstract
	* @param {any} data - The data to parse.
	*/
	parse() {}
	/**
	* Sets the `crossOrigin` String to implement CORS for loading the URL
	* from a different domain that allows CORS.
	*
	* @param {string} crossOrigin - The `crossOrigin` value.
	* @return {Loader} A reference to this instance.
	*/
	setCrossOrigin(crossOrigin) {
		this.crossOrigin = crossOrigin;
		return this;
	}
	/**
	* Whether the XMLHttpRequest uses credentials such as cookies, authorization
	* headers or TLS client certificates, see [XMLHttpRequest.withCredentials](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/withCredentials).
	*
	* Note: This setting has no effect if you are loading files locally or from the same domain.
	*
	* @param {boolean} value - The `withCredentials` value.
	* @return {Loader} A reference to this instance.
	*/
	setWithCredentials(value) {
		this.withCredentials = value;
		return this;
	}
	/**
	* Sets the base path for the asset.
	*
	* @param {string} path - The base path.
	* @return {Loader} A reference to this instance.
	*/
	setPath(path) {
		this.path = path;
		return this;
	}
	/**
	* Sets the base path for dependent resources like textures.
	*
	* @param {string} resourcePath - The resource path.
	* @return {Loader} A reference to this instance.
	*/
	setResourcePath(resourcePath) {
		this.resourcePath = resourcePath;
		return this;
	}
	/**
	* Sets the given request header.
	*
	* @param {Object} requestHeader - A [request header](https://developer.mozilla.org/en-US/docs/Glossary/Request_header)
	* for configuring the HTTP request.
	* @return {Loader} A reference to this instance.
	*/
	setRequestHeader(requestHeader) {
		this.requestHeader = requestHeader;
		return this;
	}
	/**
	* This method can be implemented in loaders for aborting ongoing requests.
	*
	* @abstract
	* @return {Loader} A reference to this instance.
	*/
	abort() {
		return this;
	}
};
/**
* Callback for onProgress in loaders.
*
* @callback onProgressCallback
* @param {ProgressEvent} event - An instance of `ProgressEvent` that represents the current loading status.
*/
/**
* Callback for onError in loaders.
*
* @callback onErrorCallback
* @param {Error} error - The error which occurred during the loading process.
*/
/**
* The default material name that is used by loaders
* when creating materials for loaded 3D objects.
*
* Note: Not all loaders might honor this setting.
*
* @static
* @type {string}
* @default '__DEFAULT'
*/
Loader.DEFAULT_MATERIAL_NAME = "__DEFAULT";
const _RESERVED_CHARS_RE = "\\[\\]\\.:\\/";
const _reservedRe = /* @__PURE__ */ new RegExp("[\\[\\]\\.:\\/]", "g");
const _wordChar = "[^\\[\\]\\.:\\/]";
const _wordCharOrDot = "[^" + _RESERVED_CHARS_RE.replace("\\.", "") + "]";
const _directoryRe = /*@__PURE__*/ /((?:WC+[\/:])*)/.source.replace("WC", _wordChar);
const _nodeRe = /*@__PURE__*/ /(WCOD+)?/.source.replace("WCOD", _wordCharOrDot);
const _objectRe = /*@__PURE__*/ /(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC", _wordChar);
const _propertyRe = /*@__PURE__*/ /\.(WC+)(?:\[(.+)\])?/.source.replace("WC", _wordChar);
const _trackRe = new RegExp("^" + _directoryRe + _nodeRe + _objectRe + _propertyRe + "$");
const _supportedObjectNames = [
	"material",
	"materials",
	"bones",
	"map"
];
var Composite = class {
	constructor(targetGroup, path, optionalParsedPath) {
		const parsedPath = optionalParsedPath || PropertyBinding.parseTrackName(path);
		this._targetGroup = targetGroup;
		this._bindings = targetGroup.subscribe_(path, parsedPath);
	}
	getValue(array, offset) {
		this.bind();
		const firstValidIndex = this._targetGroup.nCachedObjects_, binding = this._bindings[firstValidIndex];
		if (binding !== void 0) binding.getValue(array, offset);
	}
	setValue(array, offset) {
		const bindings = this._bindings;
		for (let i = this._targetGroup.nCachedObjects_, n = bindings.length; i !== n; ++i) bindings[i].setValue(array, offset);
	}
	bind() {
		const bindings = this._bindings;
		for (let i = this._targetGroup.nCachedObjects_, n = bindings.length; i !== n; ++i) bindings[i].bind();
	}
	unbind() {
		const bindings = this._bindings;
		for (let i = this._targetGroup.nCachedObjects_, n = bindings.length; i !== n; ++i) bindings[i].unbind();
	}
};
/**
* This holds a reference to a real property in the scene graph; used internally.
*/
var PropertyBinding = class PropertyBinding {
	/**
	* Constructs a new property binding.
	*
	* @param {Object} rootNode - The root node.
	* @param {string} path - The path.
	* @param {?Object} [parsedPath] - The parsed path.
	*/
	constructor(rootNode, path, parsedPath) {
		/**
		* The object path to the animated property.
		*
		* @type {string}
		*/
		this.path = path;
		/**
		* An object holding information about the path.
		*
		* @type {Object}
		*/
		this.parsedPath = parsedPath || PropertyBinding.parseTrackName(path);
		/**
		* The object owns the animated property.
		*
		* @type {?Object}
		*/
		this.node = PropertyBinding.findNode(rootNode, this.parsedPath.nodeName);
		/**
		* The root node.
		*
		* @type {Object3D|Skeleton}
		*/
		this.rootNode = rootNode;
		this.getValue = this._getValue_unbound;
		this.setValue = this._setValue_unbound;
	}
	/**
	* Factory method for creating a property binding from the given parameters.
	*
	* @static
	* @param {Object} root - The root node.
	* @param {string} path - The path.
	* @param {?Object} [parsedPath] - The parsed path.
	* @return {PropertyBinding|Composite} The created property binding or composite.
	*/
	static create(root, path, parsedPath) {
		if (!(root && root.isAnimationObjectGroup)) return new PropertyBinding(root, path, parsedPath);
		else return new PropertyBinding.Composite(root, path, parsedPath);
	}
	/**
	* Replaces spaces with underscores and removes unsupported characters from
	* node names, to ensure compatibility with parseTrackName().
	*
	* @param {string} name - Node name to be sanitized.
	* @return {string} The sanitized node name.
	*/
	static sanitizeNodeName(name) {
		return name.replace(/\s/g, "_").replace(_reservedRe, "");
	}
	/**
	* Parses the given track name (an object path to an animated property) and
	* returns an object with information about the path. Matches strings in the following forms:
	*
	* - nodeName.property
	* - nodeName.property[accessor]
	* - nodeName.material.property[accessor]
	* - uuid.property[accessor]
	* - uuid.objectName[objectIndex].propertyName[propertyIndex]
	* - parentName/nodeName.property
	* - parentName/parentName/nodeName.property[index]
	* - .bone[Armature.DEF_cog].position
	* - scene:helium_balloon_model:helium_balloon_model.position
	*
	* @static
	* @param {string} trackName - The track name to parse.
	* @return {Object} The parsed track name as an object.
	*/
	static parseTrackName(trackName) {
		const matches = _trackRe.exec(trackName);
		if (matches === null) throw new Error("THREE.PropertyBinding: Cannot parse trackName: " + trackName);
		const results = {
			nodeName: matches[2],
			objectName: matches[3],
			objectIndex: matches[4],
			propertyName: matches[5],
			propertyIndex: matches[6]
		};
		const lastDot = results.nodeName && results.nodeName.lastIndexOf(".");
		if (lastDot !== void 0 && lastDot !== -1) {
			const objectName = results.nodeName.substring(lastDot + 1);
			if (_supportedObjectNames.indexOf(objectName) !== -1) {
				results.nodeName = results.nodeName.substring(0, lastDot);
				results.objectName = objectName;
			}
		}
		if (results.propertyName === null || results.propertyName.length === 0) throw new Error("THREE.PropertyBinding: can not parse propertyName from trackName: " + trackName);
		return results;
	}
	/**
	* Searches for a node in the hierarchy of the given root object by the given
	* node name.
	*
	* @static
	* @param {Object} root - The root object.
	* @param {string|number} nodeName - The name of the node.
	* @return {?Object} The found node. Returns `null` if no object was found.
	*/
	static findNode(root, nodeName) {
		if (nodeName === void 0 || nodeName === "" || nodeName === "." || nodeName === -1 || nodeName === root.name || nodeName === root.uuid) return root;
		if (root.skeleton) {
			const bone = root.skeleton.getBoneByName(nodeName);
			if (bone !== void 0) return bone;
		}
		if (root.children) {
			const searchNodeSubtree = function(children) {
				for (let i = 0; i < children.length; i++) {
					const childNode = children[i];
					if (childNode.name === nodeName || childNode.uuid === nodeName) return childNode;
					const result = searchNodeSubtree(childNode.children);
					if (result) return result;
				}
				return null;
			};
			const subTreeNode = searchNodeSubtree(root.children);
			if (subTreeNode) return subTreeNode;
		}
		return null;
	}
	_getValue_unavailable() {}
	_setValue_unavailable() {}
	_getValue_direct(buffer, offset) {
		buffer[offset] = this.targetObject[this.propertyName];
	}
	_getValue_array(buffer, offset) {
		const source = this.resolvedProperty;
		for (let i = 0, n = source.length; i !== n; ++i) buffer[offset++] = source[i];
	}
	_getValue_arrayElement(buffer, offset) {
		buffer[offset] = this.resolvedProperty[this.propertyIndex];
	}
	_getValue_toArray(buffer, offset) {
		this.resolvedProperty.toArray(buffer, offset);
	}
	_setValue_direct(buffer, offset) {
		this.targetObject[this.propertyName] = buffer[offset];
	}
	_setValue_direct_setNeedsUpdate(buffer, offset) {
		this.targetObject[this.propertyName] = buffer[offset];
		this.targetObject.needsUpdate = true;
	}
	_setValue_direct_setMatrixWorldNeedsUpdate(buffer, offset) {
		this.targetObject[this.propertyName] = buffer[offset];
		this.targetObject.matrixWorldNeedsUpdate = true;
	}
	_setValue_array(buffer, offset) {
		const dest = this.resolvedProperty;
		for (let i = 0, n = dest.length; i !== n; ++i) dest[i] = buffer[offset++];
	}
	_setValue_array_setNeedsUpdate(buffer, offset) {
		const dest = this.resolvedProperty;
		for (let i = 0, n = dest.length; i !== n; ++i) dest[i] = buffer[offset++];
		this.targetObject.needsUpdate = true;
	}
	_setValue_array_setMatrixWorldNeedsUpdate(buffer, offset) {
		const dest = this.resolvedProperty;
		for (let i = 0, n = dest.length; i !== n; ++i) dest[i] = buffer[offset++];
		this.targetObject.matrixWorldNeedsUpdate = true;
	}
	_setValue_arrayElement(buffer, offset) {
		this.resolvedProperty[this.propertyIndex] = buffer[offset];
	}
	_setValue_arrayElement_setNeedsUpdate(buffer, offset) {
		this.resolvedProperty[this.propertyIndex] = buffer[offset];
		this.targetObject.needsUpdate = true;
	}
	_setValue_arrayElement_setMatrixWorldNeedsUpdate(buffer, offset) {
		this.resolvedProperty[this.propertyIndex] = buffer[offset];
		this.targetObject.matrixWorldNeedsUpdate = true;
	}
	_setValue_fromArray(buffer, offset) {
		this.resolvedProperty.fromArray(buffer, offset);
	}
	_setValue_fromArray_setNeedsUpdate(buffer, offset) {
		this.resolvedProperty.fromArray(buffer, offset);
		this.targetObject.needsUpdate = true;
	}
	_setValue_fromArray_setMatrixWorldNeedsUpdate(buffer, offset) {
		this.resolvedProperty.fromArray(buffer, offset);
		this.targetObject.matrixWorldNeedsUpdate = true;
	}
	_getValue_unbound(targetArray, offset) {
		this.bind();
		this.getValue(targetArray, offset);
	}
	_setValue_unbound(sourceArray, offset) {
		this.bind();
		this.setValue(sourceArray, offset);
	}
	/**
	* Creates a getter / setter pair for the property tracked by this binding.
	*/
	bind() {
		let targetObject = this.node;
		const parsedPath = this.parsedPath;
		const objectName = parsedPath.objectName;
		const propertyName = parsedPath.propertyName;
		let propertyIndex = parsedPath.propertyIndex;
		if (!targetObject) {
			targetObject = PropertyBinding.findNode(this.rootNode, parsedPath.nodeName);
			this.node = targetObject;
		}
		this.getValue = this._getValue_unavailable;
		this.setValue = this._setValue_unavailable;
		if (!targetObject) {
			warn("PropertyBinding: No target node found for track: " + this.path + ".");
			return;
		}
		if (objectName) {
			let objectIndex = parsedPath.objectIndex;
			switch (objectName) {
				case "materials":
					if (!targetObject.material) {
						error("PropertyBinding: Can not bind to material as node does not have a material.", this);
						return;
					}
					if (!targetObject.material.materials) {
						error("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.", this);
						return;
					}
					targetObject = targetObject.material.materials;
					break;
				case "bones":
					if (!targetObject.skeleton) {
						error("PropertyBinding: Can not bind to bones as node does not have a skeleton.", this);
						return;
					}
					targetObject = targetObject.skeleton.bones;
					for (let i = 0; i < targetObject.length; i++) if (targetObject[i].name === objectIndex) {
						objectIndex = i;
						break;
					}
					break;
				case "map":
					if ("map" in targetObject) {
						targetObject = targetObject.map;
						break;
					}
					if (!targetObject.material) {
						error("PropertyBinding: Can not bind to material as node does not have a material.", this);
						return;
					}
					if (!targetObject.material.map) {
						error("PropertyBinding: Can not bind to material.map as node.material does not have a map.", this);
						return;
					}
					targetObject = targetObject.material.map;
					break;
				default:
					if (targetObject[objectName] === void 0) {
						error("PropertyBinding: Can not bind to objectName of node undefined.", this);
						return;
					}
					targetObject = targetObject[objectName];
			}
			if (objectIndex !== void 0) {
				if (targetObject[objectIndex] === void 0) {
					error("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.", this, targetObject);
					return;
				}
				targetObject = targetObject[objectIndex];
			}
		}
		const nodeProperty = targetObject[propertyName];
		if (nodeProperty === void 0) {
			const nodeName = parsedPath.nodeName;
			error("PropertyBinding: Trying to update property for track: " + nodeName + "." + propertyName + " but it wasn't found.", targetObject);
			return;
		}
		let versioning = this.Versioning.None;
		this.targetObject = targetObject;
		if (targetObject.isMaterial === true) versioning = this.Versioning.NeedsUpdate;
		else if (targetObject.isObject3D === true) versioning = this.Versioning.MatrixWorldNeedsUpdate;
		let bindingType = this.BindingType.Direct;
		if (propertyIndex !== void 0) {
			if (propertyName === "morphTargetInfluences") {
				if (!targetObject.geometry) {
					error("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.", this);
					return;
				}
				if (!targetObject.geometry.morphAttributes) {
					error("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.", this);
					return;
				}
				if (targetObject.morphTargetDictionary[propertyIndex] !== void 0) propertyIndex = targetObject.morphTargetDictionary[propertyIndex];
			}
			bindingType = this.BindingType.ArrayElement;
			this.resolvedProperty = nodeProperty;
			this.propertyIndex = propertyIndex;
		} else if (nodeProperty.fromArray !== void 0 && nodeProperty.toArray !== void 0) {
			bindingType = this.BindingType.HasFromToArray;
			this.resolvedProperty = nodeProperty;
		} else if (Array.isArray(nodeProperty)) {
			bindingType = this.BindingType.EntireArray;
			this.resolvedProperty = nodeProperty;
		} else this.propertyName = propertyName;
		this.getValue = this.GetterByBindingType[bindingType];
		this.setValue = this.SetterByBindingTypeAndVersioning[bindingType][versioning];
	}
	/**
	* Unbinds the property.
	*/
	unbind() {
		this.node = null;
		this.getValue = this._getValue_unbound;
		this.setValue = this._setValue_unbound;
	}
};
PropertyBinding.Composite = Composite;
PropertyBinding.prototype.BindingType = {
	Direct: 0,
	EntireArray: 1,
	ArrayElement: 2,
	HasFromToArray: 3
};
PropertyBinding.prototype.Versioning = {
	None: 0,
	NeedsUpdate: 1,
	MatrixWorldNeedsUpdate: 2
};
PropertyBinding.prototype.GetterByBindingType = [
	PropertyBinding.prototype._getValue_direct,
	PropertyBinding.prototype._getValue_array,
	PropertyBinding.prototype._getValue_arrayElement,
	PropertyBinding.prototype._getValue_toArray
];
PropertyBinding.prototype.SetterByBindingTypeAndVersioning = [
	[
		PropertyBinding.prototype._setValue_direct,
		PropertyBinding.prototype._setValue_direct_setNeedsUpdate,
		PropertyBinding.prototype._setValue_direct_setMatrixWorldNeedsUpdate
	],
	[
		PropertyBinding.prototype._setValue_array,
		PropertyBinding.prototype._setValue_array_setNeedsUpdate,
		PropertyBinding.prototype._setValue_array_setMatrixWorldNeedsUpdate
	],
	[
		PropertyBinding.prototype._setValue_arrayElement,
		PropertyBinding.prototype._setValue_arrayElement_setNeedsUpdate,
		PropertyBinding.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate
	],
	[
		PropertyBinding.prototype._setValue_fromArray,
		PropertyBinding.prototype._setValue_fromArray_setNeedsUpdate,
		PropertyBinding.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate
	]
];
(class Matrix2 {
	static {
		/**
		* This flag can be used for type testing.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		Matrix2.prototype.isMatrix2 = true;
	}
	/**
	* Constructs a new 2x2 matrix. The arguments are supposed to be
	* in row-major order. If no arguments are provided, the constructor
	* initializes the matrix as an identity matrix.
	*
	* @param {number} [n11] - 1-1 matrix element.
	* @param {number} [n12] - 1-2 matrix element.
	* @param {number} [n21] - 2-1 matrix element.
	* @param {number} [n22] - 2-2 matrix element.
	*/
	constructor(n11, n12, n21, n22) {
		/**
		* A column-major list of matrix values.
		*
		* @type {Array<number>}
		*/
		this.elements = [
			1,
			0,
			0,
			1
		];
		if (n11 !== void 0) this.set(n11, n12, n21, n22);
	}
	/**
	* Sets this matrix to the 2x2 identity matrix.
	*
	* @return {Matrix2} A reference to this matrix.
	*/
	identity() {
		this.set(1, 0, 0, 1);
		return this;
	}
	/**
	* Sets the elements of the matrix from the given array.
	*
	* @param {Array<number>} array - The matrix elements in column-major order.
	* @param {number} [offset=0] - Index of the first element in the array.
	* @return {Matrix2} A reference to this matrix.
	*/
	fromArray(array, offset = 0) {
		for (let i = 0; i < 4; i++) this.elements[i] = array[i + offset];
		return this;
	}
	/**
	* Sets the elements of the matrix.The arguments are supposed to be
	* in row-major order.
	*
	* @param {number} n11 - 1-1 matrix element.
	* @param {number} n12 - 1-2 matrix element.
	* @param {number} n21 - 2-1 matrix element.
	* @param {number} n22 - 2-2 matrix element.
	* @return {Matrix2} A reference to this matrix.
	*/
	set(n11, n12, n21, n22) {
		const te = this.elements;
		te[0] = n11;
		te[2] = n12;
		te[1] = n21;
		te[3] = n22;
		return this;
	}
});
if (typeof __THREE_DEVTOOLS__ !== "undefined") __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register", { detail: { revision: "185" } }));
if (typeof window !== "undefined") if (window.__THREE__) warn("WARNING: Multiple instances of Three.js being imported.");
else window.__THREE__ = "185";
//#endregion
//#region \0gear
const gripSection = () => ({
	x: .013,
	z: .011
});
const makeMaterial = () => ({});
//#endregion
//#region src/combat/mathx.ts
/**
* Geometry and numeric primitives for combat and physics.
*
* Everything here is allocation-free on the hot path: the scratch vectors are
* module-local and every routine writes into caller-supplied outputs. Combat
* runs closest-point tests on a dozen capsules per swing substep, and a single
* `new THREE.Vector3()` in that loop is a garbage collection pause during the
* one moment of the game where a hitch is unforgivable.
*/
function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v;
}
new Vector3();
new Vector3();
new Vector3();
new Vector3();
new Vector3();
new Vector3();
new Quaternion();
new Vector3();
//#endregion
//#region src/combat/Viewmodel.ts
/**
* ASHLANDS — the first-person viewmodel: the arms and hands that hold the
* weapon, and the shield on the off arm.
*
* Four decisions carry this file.
*
* **The hand is not animated.** It is welded to the weapon anchor that the hit
* test already uses — `Swing.pose()` gives a hilt and an axis, `Combat`
* transforms the weapon mesh by them, and the hand takes the same transform.
* There is no second animation to drift out of sync, and there is no pose in
* which the drawn hand and the tested blade can disagree, because they are the
* same two numbers. The arm behind the hand is then two-bone IK back to a fixed
* root just off the bottom corner of the frame — the hand leads, the arm
* follows, which is also how a real arm holding a sword works.
*
* **The hand is built around the hilt, not near it.** Every phalanx is placed
* by walking a chain of straight bones around the weapon's ACTUAL grip
* cross-section (`gripSection()` in Gear.ts, which the haft prisms are also
* built from). Joint positions are solved from the law of cosines against that
* section, so the knuckles necessarily stand proud of the haft and the pads
* necessarily touch it, on every weapon class, at any camera angle. Nothing is
* eyeballed and nothing can float. The thumb's tip is then placed ON the index
* finger's middle phalanx — read off the index chain after it is solved — so it
* opposes the fingers rather than lying parallel to them.
*
* **Depth is compressed, not disabled.** The whole viewmodel — arms, hands,
* shield AND the weapon itself — is squeezed into a 17.5 cm band starting at
* 10.5 cm from the eye by a vertex-stage remap that scales each vertex ALONG
* ITS OWN VIEW RAY. Scaling along the ray leaves the projected x/y of every
* vertex bit-for-bit unchanged, so the silhouette, the TAA motion vectors (the
* prepass computes those from unsquashed world positions and is therefore still
* exactly right) and the hit test are all untouched; only the depth written
* changes. The player capsule is 34 cm in radius, so no wall can ever be closer
* than that, and a viewmodel that ends at 28 cm can never punch through one.
* Depth testing and depth writing stay ON throughout, so the arm is still
* occluded by the blade it holds and by itself. See VIEWMODEL_DEPTH in Gear.ts.
*
* **No cast shadow.** The third-person avatar owns the character's real shadow
* and is hidden in first person; if these arms cast, the only shadow on the
* ground would be a pair of disembodied forearms floating where the player's
* body should be, which is worse than the honest absence. They DO receive
* shadows — walking into a tower's shade has to darken the hands or they read
* as a UI overlay rather than as part of the world.
*/
/**
* Skin, per race, read from the RPG layer at runtime. Values are sRGB and sit
* where the third-person avatar's atlas puts Dunmer skin (linear ~0.13 with a
* violet undertone, never pink) so first and third person cannot disagree about
* whose hands these are.
*/
const SKIN = {
	dunmer: 6249323,
	altmer: 13217911,
	bosmer: 9070151,
	breton: 12821385,
	imperial: 12095866,
	khajiit: 10124373,
	nord: 13676694,
	orc: 8227438,
	redguard: 7295292,
	argonian: 6122318
};
const SKIN_FALLBACK = SKIN.dunmer;
/** Which synthesized PBR set dresses each armour material on a bracer or shield. */
const ARMOUR_SET = {
	none: "cloth",
	cloth: "cloth",
	fur: "cloth",
	hide: "cloth",
	leather: "wood_weathered",
	shell: "chitin",
	chitin: "chitin",
	bonemold: "bone",
	iron: "iron",
	steel: "iron",
	silver: "bronze",
	glass: "glass_volcanic",
	ebony: "basalt",
	daedric: "basalt"
};
const ARMOUR_LOOK = {
	none: {
		color: 7037013,
		rough: .9,
		metal: 0
	},
	cloth: {
		color: 8220770,
		rough: .92,
		metal: 0
	},
	fur: {
		color: 5983292,
		rough: .95,
		metal: 0
	},
	hide: {
		color: 6968895,
		rough: .88,
		metal: 0
	},
	leather: {
		color: 6968640,
		rough: .8,
		metal: 0
	},
	shell: {
		color: 9271890,
		rough: .45,
		metal: .08
	},
	chitin: {
		color: 9074e3,
		rough: .4,
		metal: .1
	},
	bonemold: {
		color: 13219985,
		rough: .55,
		metal: 0
	},
	iron: {
		color: 7236198,
		rough: .44,
		metal: 1
	},
	steel: {
		color: 10133670,
		rough: .3,
		metal: 1
	},
	silver: {
		color: 14210764,
		rough: .22,
		metal: 1
	},
	glass: {
		color: 5214072,
		rough: .16,
		metal: .35
	},
	ebony: {
		color: 1710620,
		rough: .2,
		metal: .7
	},
	daedric: {
		color: 2366752,
		rough: .26,
		metal: .85
	}
};
const DEFAULT_LOOK = {
	race: "dunmer",
	skin: SKIN_FALLBACK,
	sleeve: "cloth",
	rightGauntlet: null,
	leftGauntlet: null
};
function bagOf(o, key) {
	if (o === null) return null;
	const v = o[key];
	return typeof v === "object" && v !== null ? v : null;
}
/**
* Read race and equipped arm gear off whatever the 'rpg' system turns out to
* be. Duck-typed on purpose, exactly as `Resolve.ts` does for skills: combat
* must build against the engine contracts and nothing else, and a subsystem
* that hard-imports another subsystem's item tables cannot be authored
* independently of it.
*/
function readArmLook(sys) {
	const out = { ...DEFAULT_LOOK };
	if (sys === void 0) return out;
	const bag = sys;
	const character = bagOf(bag, "character") ?? bag;
	const race = character.race;
	if (typeof race === "string" && race.length > 0) {
		out.race = race;
		out.skin = SKIN[race] ?? SKIN_FALLBACK;
	}
	const inv = bagOf(character, "inventory");
	const equippedDef = inv === null ? null : inv.equippedDef;
	if (typeof equippedDef !== "function") return out;
	const lookup = (slot) => {
		try {
			const v = equippedDef.call(inv, slot);
			return typeof v === "object" && v !== null ? v : null;
		} catch {
			return null;
		}
	};
	const materialOf = (slot) => {
		const def = lookup(slot);
		if (def === null) return null;
		const m = def.material;
		if (typeof m === "string" && ARMOUR_LOOK[m] !== void 0) return m;
		return def.kind === "clothing" ? "cloth" : "leather";
	};
	out.sleeve = materialOf("robe") ?? materialOf("cuirass") ?? materialOf("shirt");
	out.rightGauntlet = materialOf("rightGauntlet");
	out.leftGauntlet = materialOf("leftGauntlet");
	return out;
}
/** Material slots a viewmodel mesh carries. Nails are not skin. */
const SLOT_SKIN = 0;
const SLOT_NAIL = 1;
/**
* Accumulator so a hand — a palm shell, two eminences, twenty phalanges, five
* nails, four extensor tendons and a wrist, sixty-odd pieces in all — comes out
* as ONE geometry and therefore one draw call, with a second material group for
* the nails. Merging by hand rather than pulling in BufferGeometryUtils keeps
* the dependency surface at three's core, which is the rule the rest of this
* directory follows.
*
* It also carries a vertex colour. That is what puts subsurface warmth in the
* fingertips and the web of the thumb, blanching on the knuckles and a darker
* value down the joint creases, none of which a tiling detail texture can place
* anatomically. Flat one-value skin is what makes a hand read as plastic.
*/
var Parts = class {
	pos = [];
	nrm = [];
	uv = [];
	col = [];
	skn = [];
	slots = [[], []];
	nm = new Matrix3();
	/**
	* `triSlot`, when given, overrides `slot` per TRIANGLE. That is what lets the
	* nails be keratin without being separate objects: they are part of the hand's
	* one extracted shell — no boundary, no socket, no shard — and only their
	* material group differs. See `seatNail`.
	*/
	add(g, m, slot = SLOT_SKIN, tint, triSlot) {
		const p = g.getAttribute("position");
		const n = g.getAttribute("normal");
		const t = g.getAttribute("uv");
		const c = g.getAttribute("color");
		const sk = g.getAttribute("askin");
		const index = g.getIndex();
		const base = this.pos.length / 3;
		const v = new Vector3();
		const rgb = [
			1,
			1,
			1
		];
		const mirrored = m !== void 0 && m.determinant() < 0;
		if (m !== void 0) this.nm.getNormalMatrix(m);
		for (let i = 0; i < p.count; i++) {
			v.set(p.getX(i), p.getY(i), p.getZ(i));
			if (m !== void 0) v.applyMatrix4(m);
			this.pos.push(v.x, v.y, v.z);
			rgb[0] = c === void 0 ? 1 : c.getX(i);
			rgb[1] = c === void 0 ? 1 : c.getY(i);
			rgb[2] = c === void 0 ? 1 : c.getZ(i);
			if (tint !== void 0) tint(v, rgb);
			this.col.push(rgb[0], rgb[1], rgb[2]);
			this.skn.push(sk === void 0 ? 0 : sk.getX(i), sk === void 0 ? .5 : sk.getY(i));
			v.set(n.getX(i), n.getY(i), n.getZ(i));
			if (m !== void 0) v.applyMatrix3(this.nm).normalize();
			this.nrm.push(v.x, v.y, v.z);
			this.uv.push(t !== void 0 ? t.getX(i) : 0, t !== void 0 ? t.getY(i) : 0);
		}
		const out = this.slots[slot];
		if (index === null) for (let i = 0; i < p.count; i += 3) out.push(base + i, base + i + 1, base + i + 2);
		else for (let i = 0; i < index.count; i += 3) {
			const a = base + index.getX(i);
			const b = base + index.getX(i + 1);
			const c = base + index.getX(i + 2);
			const dst = triSlot === void 0 ? out : this.slots[triSlot[i / 3]];
			if (mirrored) dst.push(a, c, b);
			else dst.push(a, b, c);
		}
		g.dispose();
	}
	build() {
		const g = new BufferGeometry();
		g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
		g.setAttribute("normal", new Float32BufferAttribute(this.nrm, 3));
		g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
		g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
		g.setAttribute("askin", new Float32BufferAttribute(this.skn, 2));
		const idx = [];
		for (let s = 0; s < this.slots.length; s++) {
			const start = idx.length;
			for (const i of this.slots[s]) idx.push(i);
			if (idx.length > start) g.addGroup(start, idx.length - start, s);
		}
		g.setIndex(idx);
		g.computeBoundingSphere();
		return g;
	}
};
/**
* The left hand and the left forearm are the right ones mirrored through the
* blade's flat. Mirroring the finished geometry rather than re-solving every
* chain with a sign flipped means there is exactly one hand in this file and
* therefore exactly one hand to get right.
*/
function mirrorZ(g) {
	const out = g.clone();
	const p = out.getAttribute("position");
	const n = out.getAttribute("normal");
	for (let i = 0; i < p.count; i++) {
		p.setZ(i, -p.getZ(i));
		n.setZ(i, -n.getZ(i));
	}
	const idx = out.getIndex();
	if (idx !== null) {
		for (let i = 0; i < idx.count; i += 3) {
			const b = idx.getX(i + 1);
			idx.setX(i + 1, idx.getX(i + 2));
			idx.setX(i + 2, b);
		}
		idx.needsUpdate = true;
	}
	p.needsUpdate = true;
	n.needsUpdate = true;
	out.computeBoundingSphere();
	return out;
}
/**
* Boundary of a unit superellipse |x|^n + |y|^n = 1. `n = 2` is a circle, which
* is what a cheap limb is and what nothing on a body actually is; `n = 4` is
* the rounded rectangle a sword grip and a finger pad both want.
*/
function sectionPoint(th, n, out) {
	const c = Math.cos(th);
	const s = Math.sin(th);
	if (n === 2) {
		out[0] = c;
		out[1] = s;
		return;
	}
	const e = 2 / n;
	out[0] = Math.sign(c) * Math.pow(Math.abs(c), e);
	out[1] = Math.sign(s) * Math.pow(Math.abs(s), e);
}
/** Distance from the axis out to that section along direction `th`. */
function sectionRadius(th, a, b, n) {
	const c = Math.abs(Math.cos(th)) / a;
	const s = Math.abs(Math.sin(th)) / b;
	return Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n);
}
const _sp = [0, 0];
/**
* Loft a list of rings into a closed tube. Normals are computed from the built
* surface rather than assumed, because none of these forms have an analytic
* normal once a ridge or a crease is displacing them; the seam column is welded
* afterwards so the UV seam is not also a shading seam.
*/
function sweep(rings, radial, capStart, capEnd, uRepeat = 2, vRate = 14) {
	const pos = [];
	const uv = [];
	const idx = [];
	const cols = radial + 1;
	const du = new Vector3();
	const dv = new Vector3();
	du.subVectors(rings[Math.min(1, rings.length - 1)].c, rings[0].c);
	dv.crossVectors(rings[0].u, rings[0].v);
	const flip = dv.dot(du) < 0;
	let run = 0;
	for (let r = 0; r < rings.length; r++) {
		const R = rings[r];
		if (r > 0) run += R.c.distanceTo(rings[r - 1].c);
		for (let i = 0; i <= radial; i++) {
			const th = i / radial * Math.PI * 2;
			sectionPoint(th, R.n, _sp);
			let x = R.c.x + R.u.x * _sp[0] * R.ru + R.v.x * _sp[1] * R.rv;
			let y = R.c.y + R.u.y * _sp[0] * R.ru + R.v.y * _sp[1] * R.rv;
			let z = R.c.z + R.u.z * _sp[0] * R.ru + R.v.z * _sp[1] * R.rv;
			if (R.bump !== void 0) {
				const b = R.bump(th);
				if (b !== 0) {
					const ca = Math.cos(th);
					const sa = Math.sin(th);
					x += (R.u.x * ca + R.v.x * sa) * b;
					y += (R.u.y * ca + R.v.y * sa) * b;
					z += (R.u.z * ca + R.v.z * sa) * b;
				}
			}
			pos.push(x, y, z);
			uv.push(i / radial * uRepeat, run * vRate);
		}
	}
	for (let r = 0; r + 1 < rings.length; r++) for (let i = 0; i < radial; i++) {
		const a = r * cols + i;
		const b = a + 1;
		const c = a + cols;
		const d = c + 1;
		if (flip) idx.push(a, c, b, b, c, d);
		else idx.push(a, b, c, b, d, c);
	}
	/**
	* Close an end with a fan on DUPLICATED vertices.
	*
	* Sharing the ring's own vertices with the cap is the obvious thing to do and
	* it is wrong: `computeVertexNormals` then averages the cap's axial normal
	* into the tube's radial one, and the last ring of every swept part in this
	* file tilts about forty degrees. On a forearm whose tip is capped inside the
	* hand that draws a hard dark ring right round the wrist — the "bracelet"
	* that survived three attempts at fixing the geometry, because the geometry
	* was never what was wrong. On a fingertip it flattens the last ring into the
	* disc the review called a cylinder end-cap. Duplicating costs one ring of
	* vertices per cap and makes both go away.
	*/
	const fan = (row, outward) => {
		const base = pos.length / 3;
		const R = rings[row];
		for (let i = 0; i <= radial; i++) {
			const s3 = (row * cols + i) * 3;
			const s2 = (row * cols + i) * 2;
			pos.push(pos[s3], pos[s3 + 1], pos[s3 + 2]);
			uv.push(uv[s2], uv[s2 + 1]);
		}
		const c = pos.length / 3;
		pos.push(R.c.x, R.c.y, R.c.z);
		uv.push(uRepeat * .5, run * vRate * (row === 0 ? 0 : 1));
		for (let i = 0; i < radial; i++) {
			const a = base + i;
			const b = a + 1;
			if (outward !== flip) idx.push(c, a, b);
			else idx.push(c, b, a);
		}
	};
	if (capStart) fan(0, false);
	if (capEnd) fan(rings.length - 1, true);
	const g = new BufferGeometry();
	g.setAttribute("position", new Float32BufferAttribute(pos, 3));
	g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
	g.setIndex(idx);
	g.computeVertexNormals();
	const n = g.getAttribute("normal");
	for (let r = 0; r < rings.length; r++) {
		const a = r * cols;
		const b = a + radial;
		const x = n.getX(a) + n.getX(b);
		const y = n.getY(a) + n.getY(b);
		const z = n.getZ(a) + n.getZ(b);
		const l = Math.hypot(x, y, z) || 1;
		n.setXYZ(a, x / l, y / l, z / l);
		n.setXYZ(b, x / l, y / l, z / l);
	}
	n.needsUpdate = true;
	return g;
}
/**
* Sample a keyed curve with smoothstep between the keys.
*
* Anatomy is authored as landmarks a life model actually shows — where the
* bellies peak, where the shaft is, where the wrist waists — and read back as a
* continuous curve. A polynomial fitted to those landmarks would be shorter and
* would also let one of them drift the moment another moved.
*/
function curve(keys, t) {
	if (t <= keys[0][0]) return keys[0][1];
	for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
		const t0 = keys[i - 1][0];
		const v0 = keys[i - 1][1];
		const f = (t - t0) / Math.max(keys[i][0] - t0, 1e-6);
		return v0 + (keys[i][1] - v0) * (f * f * (3 - 2 * f));
	}
	return keys[keys.length - 1][1];
}
/** Signed angular distance from `th` to `c`, wrapped to (-pi, pi]. */
function angDelta(th, c) {
	let d = th - c;
	while (d > Math.PI) d -= Math.PI * 2;
	while (d < -Math.PI) d += Math.PI * 2;
	return d;
}
const gauss = (x, w) => Math.exp(-(x / w * (x / w)));
/**
* A forearm. Not a tube.
*
* The section is authored as a CIRCUMFERENCE and an ASPECT rather than as a
* radius, because that is what a tape measure reads and it is the only way the
* two stay honest together: an ellipse that flattens while keeping its mean
* radius is silently getting fatter round the outside. Peak girth is 28 cm at
* t = 0.19, at the flexor and extensor bellies — NOT at the elbow, which is
* narrower than the muscle below it — and the wrist is 16 cm, a 43% fall. Over
* the same run the section goes from 1.16:1 (nearly round under the elbow) to
* 1.53:1 (distinctly flattened front-to-back at the wrist) and twists 26
* degrees as the radius crosses the ulna.
*
* That profile alone still reads as a turned chess piece, which is what the
* first version of this was: a bottle. What makes it a FOREARM is the relief on
* top of it, and every piece of that relief is a named structure —
*
*   - the ULNA, a hard narrow crest down the little-finger side with a groove
*     between it and the extensor mass, ending in the styloid knob at the wrist;
*   - the FLEXOR belly on the palmar face and the EXTENSOR belly opposite,
*     both peaking in the upper third;
*   - the BRACHIORADIALIS, which crosses from the radial-dorsal side of the
*     upper forearm to the radial-palmar side of the wrist — it is the visible
*     cause of the twist rather than a decoration on it;
*   - the two FLEXOR TENDONS standing proud just above the wrist, which after
*     the ulna is the strongest "this is a real arm" cue at first-person range;
*   - the RADIAL styloid opposite the ulnar one.
*
* The styloid is a bump in the sweep, not a stuck-on ellipsoid: as a separate
* primitive it read as a wart sitting on an otherwise smooth surface, which is
* exactly what it looked like.
*
* Built with +X as the ulnar side and the wrist at +Y, so the poser can roll it
* about the bone axis to put the ulna where the hand says the little finger is.
*/
const FOREARM_ULNAR = new Vector3(1, 0, 0);
/**
* Circumference along the bone as a fraction of the peak. Measured landmarks.
*
* THE SHAPE OF THIS CURVE IS THE WHOLE SILHOUETTE READ, and the two things that
* matter about it are not "does it taper" — every cone tapers — but WHERE its
* curvature changes sign:
*
*   - CONVEX over 0.10-0.50. The muscle mass peaks a quarter down and then
*     stays within 6% of peak all the way to mid-shaft, so what the camera sees
*     is a broad belly bulging OUT of the line joining the ends, not a slope.
*   - CONCAVE over 0.55-0.93. The fall is steepest at 0.6-0.75 and then flattens
*     hard into the wrist, so the outline hollows INWARD as it arrives. That
*     hollow is the "tightening" a forearm has and a lathe turning does not.
*
* The previous curve fell at a near-constant rate from 0.30 to 0.95, which is
* the definition of a straight edge. It measured 0.0 mm of distal sag against
* its own chord, and a straight edge is a cone is a pipe — which is what the
* player said, twice.
*
* THE ENDS ARE MEASUREMENTS, not free parameters, and the revision before this
* had both of them wrong in the direction that turns a forearm into a SKITTLE.
* A tape round a lean adult reads 25.5 cm at the belly and 16.1 cm at the
* wrist — the wrist is 63% of the peak, not 56% — and the girth just below the
* elbow crease is 90% of peak, not 85%: the muscles arise from the epicondyles,
* so the limb is already nearly full width where it leaves the joint. Ending at
* 0.5611 off a 0.855 start drew a bulb on a stem with a 2.85:1 fall down the
* narrow view, which is a bottle, and a bottle is a lathe turning exactly as
* much as a pipe is. What stops it being either is not the profile at all; it
* is FOREARM_BELLY_OFF below.
*
* The last value is not chosen, it is SOLVED: with FOREARM_RATIO ending at
* 1.79, a girth of 0.543 x 25.5 cm is exactly the 2.72 x 1.52 cm ellipse the
* hand's own wrist runs at, so the shaft arrives at the hand's section without
* anything having to be forced there.
*
* AND THE END VALUE CAME DOWN, from 0.632 to 0.543 — a 40% fall from just below
* the elbow, which is what a tape actually reads. At 0.632 the shaft arrived at
* the hand 6.2 cm wide against an 8.3 cm palm: the wrist was 75% of the hand,
* the closed fist was no wider than the tube it sat on, and the mass ordering
* along the limb was therefore INVERTED. That is most of what made the
* silhouette read as a bowling pin — not the profile of the shaft, but the fact
* that the knob on the end of it was not bigger than the stem.
*/
const FOREARM_GIRTH = [
	[0, .9],
	[.07, .968],
	[.17, .998],
	[.26, 1],
	[.36, .98],
	[.46, .93],
	[.54, .86],
	[.62, .77],
	[.7, .69],
	[.78, .628],
	[.86, .585],
	[.93, .56],
	[1, .543]
];
/**
* Section aspect (across the flexors : through them) on the same parameter.
* 1.20:1 under the elbow, 1.6:1 at mid-shaft, 1.79:1 at the wrist.
*
* This is the second independent taper and it is worth as much as the first: a
* 1.20:1 section losing 46% of its girth while flattening to 1.79:1 loses 34%
* of its WIDTH and 56% of its DEPTH, so the limb narrows by nearly twice as
* much seen from the side as it does from the front. A limb that tapers by the
* same amount from every direction is a lathe turning, whatever its profile.
*
* IT USED TO START AT 1.13, which is a circle to within a rounding error, and
* the review read that off the render immediately: "the shading terminator
* falls off radially and symmetrically on both contours, which is the signature
* of a cylinder". A pronated forearm is never round anywhere. 1.20 at the elbow
* and 1.58 by mid-shaft — which is the stretch the camera actually sees — puts
* the long axis of the section across the flexors from the first ring, and the
* flat authored in `forearmFlat` then takes the ulnar quadrant off the ellipse
* entirely.
*/
const FOREARM_RATIO = [
	[0, 1.2],
	[.2, 1.4],
	[.45, 1.58],
	[.65, 1.66],
	[.82, 1.73],
	[1, 1.79]
];
/**
* THE ANTI-LATHE TERM, and the one thing in this file that a profile curve and
* a relief field together still cannot do.
*
* Everything above turns the forearm on a lathe: a section of some size and
* some aspect, centred on the bone, at every station. Turn ANY profile that
* way — a cone, a bottle, a chess pawn — and the two edges of the silhouette
* are mirror images, because they are the same curve reflected. A real forearm
* is not: the ULNAR border is a nearly straight line from the olecranon to the
* styloid (it is subcutaneous bone the whole way, with no muscle on it), while
* the radial-palmar side carries the entire flexor and brachioradialis mass and
* bulges hard out of the chord. One edge straight, one edge convex.
*
* So the section CENTRE is displaced off the bone, radially and a little
* palmar, peaking a quarter down and gone by the wrist. At the belly that is
* 6.4 mm on a 45 mm half-width — the ulnar outline moves in by 6.4 mm and the
* radial outline moves out by the same, a 13 mm difference between two edges
* that were identical, which is the difference between an arm and a turning.
*
* It is deliberately invisible to the symmetric bulge/waist measure in
* `tools/limbs.mjs` (that reads hi-minus-lo, which a centre offset cannot
* change). Passing that measure was never the goal; it only ever said the
* profile had stopped being a straight line.
*/
const FOREARM_BELLY_OFF = [
	[0, .42],
	[.1, .84],
	[.24, 1],
	[.4, .95],
	[.56, .76],
	[.7, .52],
	[.84, .26],
	[.94, .06],
	[1, 0]
];
/** Peak circumference, metres. A lean adult forearm. */
const FOREARM_GIRTH_PEAK = .255;
/**
* Twist of the section from the wrist back to the elbow, radians. ANCHORED AT
* THE WRIST, not the elbow: the distal ring has to arrive at the hand's own
* wrist section in the hand's own orientation, or the two ellipses meet at an
* angle and the join shows as a bracelet — which is exactly what it did.
*/
const FOREARM_TWIST = .46;
/**
* Where along the bone the hand's sleeve starts covering it: 1 - WRIST_SLEEVE /
* FORE, written out because both of those are declared further down the file
* and a module-level constant may not reach forward to them. Everything past
* this point is inside the hand and is drawn for the join, not for the eye —
* which is also why all the relief has to be gone by it.
*/
const SLEEVE_T = .935;
/**
* The section the forearm's shaft has at `t`, before relief. Shared with the
* vein pass so a vein rides the surface it is actually on.
*/
function forearmSection(t) {
	const a = Math.sqrt(curve(FOREARM_RATIO, t));
	const k = Math.sqrt((a * a + 1 / (a * a)) * .5);
	const mean = FOREARM_GIRTH_PEAK * curve(FOREARM_GIRTH, t) / (2 * Math.PI * k);
	let ru = mean * a;
	let rv = mean / a;
	const s = clamp((t - .94) / .06, 0, 1);
	const e = s * s * (3 - 2 * s);
	ru += (WRIST_RU - ru) * e;
	rv += (WRIST_RV - rv) * e;
	const tuck = 1 - .06 * clamp((t - SLEEVE_T) / .06499999999999995, 0, 1) ** .9;
	const belly = curve(FOREARM_BELLY_OFF, t);
	return {
		ru: ru * tuck,
		rv: rv * tuck,
		twist: (t - 1) * FOREARM_TWIST,
		ou: -.0078 * belly,
		ov: -.0034 * belly
	};
}
/**
* Radial relief on the forearm shaft at (t, th). Every term is a named
* structure, and every RIDGE has a HOLLOW beside it.
*
* That last point is the one the previous version missed and it is why nothing
* it carried was visible: a ridge on a convex limb is lit almost exactly as the
* limb is, because its normal only ever leaves the limb's normal by the ridge's
* own slope. What the eye reads as a tendon or a bone is not the ridge, it is
* the SHADOW LINE in the trough next to it — the pair together turn a couple of
* millimetres of displacement into a full dark-to-light transition. So the ulna
* gets two grooves, the brachioradialis gets the furrow between it and the
* extensors, and the bellies get the musculotendinous step where they end.
*
* The other half of the fix is resolution. These features are 6-9 degrees wide;
* at the old RADIAL = 26 (13.8 degrees a column) every one of them was sampled
* by two vertices and averaged into the shaft. They are unchanged in kind and
* about 30% larger in amplitude — what changed is that the mesh can now hold
* them.
*
* Angles: th = 0 is ULNAR (+u), th = -pi/2 is PALMAR, th = pi is RADIAL,
* th = +pi/2 is DORSAL, all in the twisted section frame.
*/
/**
* Take a FLAT off a swept section.
*
* `R` is the radius the ellipse has at `th`; the plane's outward normal points
* at `thP` and the plane sits `dP` from the section centre. Every point whose
* projection onto that normal overshoots the plane is pulled straight back to
* it, so the result is a genuine planar facet with a soft edge — not a dent, not
* a scallop, and not a gaussian pretending to be one.
*
* This is the operator the forearm needed and did not have. Displacement fields
* can only ever ADD to a lathe turning or take a hollow out of it; both leave
* the section convex everywhere, and a section that is convex everywhere reads
* as a tube however cleverly it is modulated. The SUBCUTANEOUS BORDER OF THE
* ULNA is not convex: it is bare bone under skin from the olecranon to the
* styloid, with a flat plane of skin lying straight on it, and it is the single
* feature that tells a viewer at a glance which side of a forearm they are
* looking at.
*/
function flat(R, th, thP, dP, soft) {
	const c = Math.cos(angDelta(th, thP));
	if (c <= .26) return 0;
	const over = R * c - dP;
	return -(.5 * (over + Math.sqrt(over * over + soft * soft) - soft)) / c;
}
function forearmRelief(t, th, ru, rv) {
	let b = 0;
	{
		const R = sectionRadius(th, ru, rv, 2);
		const depth = .905 - .04 * clamp((t - .2) / .6, 0, 1);
		const thP = .52 + .1 * t;
		const ramp = clamp((t - .03) / .16, 0, 1);
		b += ramp * flat(R, th, thP, sectionRadius(thP, ru, rv, 2) * depth, .006);
	}
	const uRamp = clamp((t - .02) / .2, 0, 1) ** .55;
	b += .0098 * uRamp * gauss(angDelta(th, 0), .145);
	const gRamp = clamp((t - .06) / .2, 0, 1) * (1 + .62 * clamp((t - .45) / .35, 0, 1));
	b -= .0056 * gRamp * gauss(angDelta(th, .48), .19);
	b -= .0042 * gRamp * gauss(angDelta(th, -.44), .175);
	b += .0055 * gauss(t - .25, .22) * gauss(angDelta(th, -Math.PI / 2), .85);
	b += .004 * gauss(t - .31, .25) * gauss(angDelta(th, Math.PI * .6), .76);
	b += .0045 * gauss(t - .28, .23) * gauss(angDelta(th, Math.PI + .62 - t * 1.1), .48);
	b -= .0042 * gauss(t - .34, .27) * gauss(angDelta(th, Math.PI * .83 - t * .3), .19);
	const mt = t - (.655 + .075 * Math.cos(th + .5));
	b -= .003 * gauss(mt, .06) * (.55 + .45 * Math.cos(th));
	b -= .0016 * gauss(t - .76, .085);
	const tend = .0034 * gauss(t - .835, .085);
	b += tend * (gauss(angDelta(th, -Math.PI / 2 + .27), .11) + .85 * gauss(angDelta(th, -Math.PI / 2 - .33), .125));
	const ext = .0038 * gauss(t - .855, .1);
	b += ext * (gauss(angDelta(th, 1.24), .15) + gauss(angDelta(th, 1.66), .15) + .8 * gauss(angDelta(th, 2.06), .155));
	b -= .003 * gauss(t - .855, .1) * (gauss(angDelta(th, 1.45), .1) + gauss(angDelta(th, 1.86), .105));
	b += .0044 * gauss(t - .885, .048) * gauss(angDelta(th, Math.PI), .3);
	const f = clamp((t - .89) / .045, 0, 1);
	return b * (1 - f * f * (3 - 2 * f));
}
function forearmGeometry(len) {
	const p = new Parts();
	/**
	* 84 x 64 — ten thousand triangles for one forearm, and it is the right call.
	*
	* The relief in `forearmRelief` is authored at 7-11 degrees of arc: a tendon
	* cord, the ulnar crest, the furrow beside brachioradialis. At the old
	* RADIAL = 26 a column was 13.8 degrees, so every one of those features was
	* carried by two vertices and `computeVertexNormals` averaged it flat — the
	* arm measured as having anatomy and rendered as a vase, which is exactly
	* what the black-shape test showed. At 64 columns a 7-degree feature spans
	* four, which is the minimum that survives normal averaging with its shadow
	* line intact. Along the bone, 84 rings puts a ring every 2.9 mm, enough for
	* the musculotendinous step to be a step rather than a ramp.
	*
	* The viewmodel is ~1800 triangles in a 14 M triangle frame. Two forearms at
	* ten thousand each is a fifth of one per cent of the frame and it buys the
	* single most-looked-at surface in the game.
	*/
	const RINGS = 84;
	/**
	* 88 COLUMNS, not 64. The relief this arm is read by — the ulnar crest, the
	* two grooves flanking it, the furrow beside brachioradialis, the extensor
	* cords — is authored at seven to nine degrees of arc. A column at 64 is 5.6
	* degrees, which carries a nine-degree feature on two vertices and a
	* seven-degree one on one; at 88 the same features span three to four columns
	* and survive normal averaging with their shadow lines intact. It costs six
	* thousand triangles on a limb the player looks at more than any other
	* surface in the game.
	*/
	const RADIAL = 88;
	const rings = [];
	const ru = [];
	const rv = [];
	for (let i = 0; i <= RINGS; i++) {
		const s = forearmSection(i / RINGS);
		ru.push(s.ru);
		rv.push(s.rv);
	}
	for (let pass = 0; pass < 14; pass++) for (const a of [ru, rv]) {
		const b = a.slice();
		for (let i = 1; i < a.length - 1; i++) a[i] = (b[i - 1] + b[i] * 2 + b[i + 1]) * .25;
	}
	const centre = (t, y, s) => {
		const cw = Math.cos(s.twist);
		const sw = Math.sin(s.twist);
		return new Vector3(cw * s.ou + sw * s.ov, y, sw * s.ou - cw * s.ov);
	};
	for (const [dy, k] of [
		[-.02, .16],
		[-.017, .48],
		[-.012, .76],
		[-.006, .94]
	]) {
		const s = forearmSection(0);
		rings.push({
			c: centre(0, dy, s),
			u: new Vector3(Math.cos(s.twist), 0, Math.sin(s.twist)),
			v: new Vector3(Math.sin(s.twist), 0, -Math.cos(s.twist)),
			ru: ru[0] * k,
			rv: rv[0] * k,
			n: 2
		});
	}
	for (let i = 0; i <= RINGS; i++) {
		const t = i / RINGS;
		const s = forearmSection(t);
		const cw = Math.cos(s.twist);
		const sw = Math.sin(s.twist);
		rings.push({
			c: centre(t, t * len, s),
			u: new Vector3(cw, 0, sw),
			v: new Vector3(sw, 0, -cw),
			ru: ru[i],
			rv: rv[i],
			n: 2,
			bump: (th) => forearmRelief(t, th, ru[i], rv[i])
		});
	}
	const shaft = sweep(rings, RADIAL, true, true, 3, 15);
	/**
	* Per-vertex skin control on the shaft: no subsurface (a forearm is 6 cm
	* through and nothing gets past that), and a grain that CHANGES DENSITY along
	* and around the limb.
	*
	* The review: "The whole arm carries one tiling granular/wrinkle noise at
	* identical density from elbow to fingertip — it reads as elephant hide or a
	* knitted sock." That is exactly what a single tiling detail set does, and no
	* amount of authoring inside the tile can fix it, because the defect is that
	* the tile is the same everywhere. Real forearm skin is not: the FLEXOR side
	* is smooth and almost hairless, the DORSAL and ULNAR faces are coarse,
	* cross-hatched and haired, and it all coarsens toward the wrist and the back
	* of the hand. Two channels of mask and a second octave in the shader turn
	* one tile into a surface with regions.
	*/
	{
		const pos = shaft.getAttribute("position");
		const sk = new Float32Array(pos.count * 2);
		for (let i = 0; i < pos.count; i++) {
			const t = clamp(pos.getY(i) / len, 0, 1);
			const s = forearmSection(t);
			const cw = Math.cos(s.twist);
			const sw = Math.sin(s.twist);
			const x = pos.getX(i);
			const z = pos.getZ(i);
			const th = Math.atan2((x * sw - z * cw) / s.rv, (x * cw + z * sw) / s.ru);
			const face = .5 + .5 * Math.cos(angDelta(th, .75));
			sk[i * 2] = 0;
			sk[i * 2 + 1] = clamp(.16 + .55 * face + .3 * clamp((t - .45) / .45, 0, 1), 0, 1);
		}
		shaft.setAttribute("askin", new BufferAttribute(sk, 2));
	}
	p.add(shaft);
	for (const [phase, base] of [[.4, 1.02], [2.3, 1.86]]) {
		const vr = [];
		const N = 12;
		for (let i = 0; i <= N; i++) {
			const t = .3 + i / N * .42;
			const th = base + Math.sin(phase + t * 5.4) * .34 + Math.sin(phase * 2.1 + t * 11) * .11;
			const s = forearmSection(t);
			const surface = sectionRadius(th, s.ru, s.rv, 2) + forearmRelief(t, th, s.ru, s.rv);
			const cw = Math.cos(s.twist);
			const sw = Math.sin(s.twist);
			const dx = cw * Math.cos(th) + sw * Math.sin(th);
			const dz = sw * Math.cos(th) - cw * Math.sin(th);
			const r = .0013 * Math.sin(Math.PI * (i / N)) ** .45;
			const cc = centre(t, t * len, s);
			vr.push({
				c: cc.set(cc.x + dx * (surface - .001), cc.y, cc.z + dz * (surface - .001)),
				u: new Vector3(dx, 0, dz),
				v: new Vector3(dz, 0, -dx),
				ru: r,
				rv: r,
				n: 2
			});
		}
		p.add(sweep(vr, 6, false, false, 1, 20));
	}
	return p.build();
}
/**
* How far past the elbow the upper arm's own skin runs, as a fraction of its
* authored length. THIS IS NOT A DETAIL — it is the difference between an arm
* and an amputation.
*
* The forearm is a closed tube: whatever is done to its proximal end, that end
* exists, and in first person it is IN FRAME. Every capture before this one has
* a pale rounded stump with a dark disc in the middle of it sitting in the
* bottom corner of the screen — a limb sawn off below the elbow and floating
* there, which is most of why the whole thing read as a length of pipe rather
* than as an arm belonging to a body. Two tubes butted at a joint cannot fix
* it either: the elbow flexes to ninety degrees and there is no pair of tube
* ends that closes at ninety degrees.
*
* What closes at any angle is a BALL. The upper arm therefore ends in the
* elbow itself — condyles, olecranon and all — sized to swallow the forearm's
* proximal dome whichever way the joint is bent, and it runs past the joint
* centre by this much so the swallow has margin. The joint is drawn by the
* segment that is sleeved and mostly off screen, so it costs nothing on the
* surface the player is actually looking at.
*/
const ELBOW_LAP = .16;
/**
* An upper arm, and the elbow on the end of it.
*
* The shaft is a plain elliptical taper with a little deltoid and triceps mass
* — it is under a sleeve and mostly off the edge of the frame. The last fifth
* is the part that matters: the limb swells into the humeral condyles (an
* elbow is the WIDEST part of the arm, medio-laterally, and markedly flatter
* front-to-back than the shaft above it), carries the olecranon as a bump on
* the dorsal side, and closes as a dome rather than a disc.
*/
function upperArmGeometry(len) {
	const rings = [];
	const RINGS = 26;
	const END = 1.16;
	const mean = (t) => .046 * (1 - .12 * Math.min(t, 1)) * (1 + .07 * gauss(t - .25, .28)) * (1 + .16 * clamp((t - .74) / .3, 0, 1) ** 1.6);
	const aspect = (t) => Math.sqrt(1.16 + .14 * clamp((t - .7) / .3, 0, 1) ** 1.3);
	for (let i = 0; i <= RINGS; i++) {
		const t = i / RINGS * END;
		const a = aspect(t);
		const m = mean(t);
		const d = clamp((t - 1) / ELBOW_LAP, 0, 1);
		const k = Math.sqrt(Math.max(0, 1 - d * d));
		rings.push({
			c: new Vector3(0, t * len, 0),
			u: new Vector3(1, 0, 0),
			v: new Vector3(0, 0, -1),
			ru: m * a * (.05 + .95 * k),
			rv: m / a * (.05 + .95 * k),
			n: 2,
			bump: (th) => .008 * gauss(t - .99, .1) * gauss(angDelta(th, Math.PI / 2), .62) - .003 * gauss(t - .84, .07) * gauss(angDelta(th, Math.PI / 2), .5)
		});
	}
	const p = new Parts();
	p.add(sweep(rings, 28, true, true, 3, 15));
	return p.build();
}
/** Polynomial smooth min/max. `k` is the fillet radius, in metres. */
function smin(a, b, k) {
	const t = Math.max(k - Math.abs(a - b), 0) / k;
	return Math.min(a, b) - t * t * k * .25;
}
function smax(a, b, k) {
	const t = Math.max(k - Math.abs(a - b), 0) / k;
	return Math.max(a, b) + t * t * k * .25;
}
/** Value the field holds where nothing has been written. Far outside any skin. */
const FAR = .09;
/**
* The one primitive a hand needs: a segment with a radius at each end and an
* ELLIPTICAL section. A phalanx is wider than it is deep, a wrist is twice as
* wide as it is deep, a metacarpal ray is round; three numbers cover all of it.
* Boxes, spheres and lathes are conspicuously absent, which is the point.
*/
var Skin = class {
	shapes = [];
	limb(a, b, r0, r1, across, wide, deep, k, cut = false) {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const dz = b.z - a.z;
		const L = Math.max(Math.hypot(dx, dy, dz), 1e-6);
		const tx = dx / L;
		const ty = dy / L;
		const tz = dz / L;
		let ux = across.x;
		let uy = across.y;
		let uz = across.z;
		const pr = ux * tx + uy * ty + uz * tz;
		ux -= tx * pr;
		uy -= ty * pr;
		uz -= tz * pr;
		let ul = Math.hypot(ux, uy, uz);
		if (ul < 1e-9) {
			ux = -ty;
			uy = tx;
			uz = 0;
			ul = Math.hypot(ux, uy, uz);
			if (ul < 1e-9) {
				ux = 1;
				uy = 0;
				uz = 0;
				ul = 1;
			}
		}
		ux /= ul;
		uy /= ul;
		uz /= ul;
		const vx = ty * uz - tz * uy;
		const vy = tz * ux - tx * uz;
		const vz = tx * uy - ty * ux;
		const ax = a.x;
		const ay = a.y;
		const az = a.z;
		const iw = 1 / wide;
		const id = 1 / deep;
		const dr = r1 - r0;
		const s = Math.min(wide, deep, 1);
		const reach = Math.max(r0, r1) * Math.max(wide, deep, 1) + k / s + .005;
		this.shapes.push({
			f: (x, y, z) => {
				const px = x - ax;
				const py = y - ay;
				const pz = z - az;
				const pt = px * tx + py * ty + pz * tz;
				const h = pt < 0 ? 0 : pt > L ? 1 : pt / L;
				const pu = (px * ux + py * uy + pz * uz) * iw;
				const pv = (px * vx + py * vy + pz * vz) * id;
				const pa = pt - h * L;
				return (Math.sqrt(pu * pu + pv * pv + pa * pa) - (r0 + dr * h)) * s;
			},
			x0: Math.min(a.x, b.x) - reach,
			x1: Math.max(a.x, b.x) + reach,
			y0: Math.min(a.y, b.y) - reach,
			y1: Math.max(a.y, b.y) + reach,
			z0: Math.min(a.z, b.z) - reach,
			z1: Math.max(a.z, b.z) + reach,
			k,
			cut
		});
	}
	/**
	* THE HAFT ITSELF, as a solid, so the hand can be cut back out of it.
	*
	* A superelliptic prism up the grip axis with exactly the section the finger
	* chains were solved against. Subtracted from the hand it does the one thing
	* the review said no version of this had managed: "the fingertips float in
	* front of the grip or interpenetrate it — they never flatten, so no pad
	* deforms against the hilt". The chains put every pad about a millimetre and a
	* half INSIDE the haft on purpose, because that is what a grip is; up to now
	* that millimetre and a half simply vanished into the weapon mesh. Cutting it
	* away instead leaves a real contact flat on each pad, and because the
	* subtraction carries a fillet, the flesh either side of the flat swells over
	* the edge of it — which is the compression bulge that makes a grip look like
	* it is being held rather than passed through.
	*
	* It is also the only thing that can guarantee no part of the hand is ever
	* drawn inside the weapon, on any weapon, at any camera angle.
	*/
	prism(x, z, n, y0, y1, k) {
		const s = Math.min(x, z);
		const e = 2 / n;
		this.shapes.push({
			f: (px, py, pz) => {
				const a = Math.abs(px) / x;
				const b = Math.abs(pz) / z;
				const q = (Math.pow(Math.pow(a, n) + Math.pow(b, n), e * .5) - 1) * s;
				const dy = Math.max(y0 - py, py - y1);
				if (q <= 0 && dy <= 0) return Math.max(q, dy);
				const cq = Math.max(q, 0);
				const cy = Math.max(dy, 0);
				return Math.sqrt(cq * cq + cy * cy);
			},
			x0: -x - k,
			x1: x + k,
			y0: y0 - k,
			y1: y1 + k,
			z0: -z - k,
			z1: z + k,
			k,
			cut: true
		});
	}
};
/**
* Every `Shape.f` in this file is 1-LIPSCHITZ — it never changes faster than one
* metre per metre — and that is what lets `rasterise` sphere-trace along a row
* instead of evaluating every cell in a part's influence box.
*
* `limb` returns `(|p| in a section-scaled frame - r) * min(wide, deep, 1)`. The
* scaling expands the frame by at most `1/min(wide, deep, 1)`, and the trailing
* multiply takes exactly that back out, so the gradient magnitude is bounded by
* one everywhere. `prism` is the same statement about a superellipse scaled by
* its own smaller half-extent. Anything added to `Skin` later MUST hold this or
* the skip below will step over surfaces: the two-line rule is "divide by a
* half-extent, multiply the result by the smallest half-extent you divided by".
*
* The safety factor is there so that a hand-authored shape which is Lipschitz to
* within a few per cent (the superelliptic radial distance is approximate off
* its axes) still cannot outrun the trace.
*/
const LIPSCHITZ = 1.35;
/**
* Sample the field onto a grid.
*
* Each shape only visits the cells inside its own influence box, and inside that
* box it SKIPS AHEAD by however far its own returned distance says the surface
* cannot be. That turns the cost of a part from its bounding volume into its
* surface area, which is the difference between 730 ms and 150 ms a hand and is
* therefore the entire reason the voxel pitch below could come down from 2.0 mm
* to 1.3 mm. At 2.0 mm every feature this hand is read by — a 1.5 mm knuckle, a
* 2.4 mm crease, a 1.9 mm tendon, a 0.9 mm nail bed — was at or under one cell,
* so the extraction averaged all of them into a smooth blob and then jittered
* the nail beds into craters. The anatomy was authored; the grid could not hold
* it.
*/
function rasterise(shapes, h) {
	let lx = Infinity, ly = Infinity, lz = Infinity;
	let hx = -Infinity, hy = -Infinity, hz = -Infinity;
	for (const s of shapes) {
		if (s.cut) continue;
		lx = Math.min(lx, s.x0);
		ly = Math.min(ly, s.y0);
		lz = Math.min(lz, s.z0);
		hx = Math.max(hx, s.x1);
		hy = Math.max(hy, s.y1);
		hz = Math.max(hz, s.z1);
	}
	const ox = lx - h;
	const oy = ly - h;
	const oz = lz - h;
	const nx = Math.ceil((hx - ox) / h) + 2;
	const ny = Math.ceil((hy - oy) / h) + 2;
	const nz = Math.ceil((hz - oz) / h) + 2;
	const d = new Float32Array(nx * ny * nz).fill(FAR);
	const g = {
		ox,
		oy,
		oz,
		nx,
		ny,
		nz,
		h,
		d
	};
	for (const s of shapes) {
		const i0 = Math.max(0, Math.floor((s.x0 - ox) / h));
		const i1 = Math.min(nx - 1, Math.ceil((s.x1 - ox) / h));
		const j0 = Math.max(0, Math.floor((s.y0 - oy) / h));
		const j1 = Math.min(ny - 1, Math.ceil((s.y1 - oy) / h));
		const k0 = Math.max(0, Math.floor((s.z0 - oz) / h));
		const k1 = Math.min(nz - 1, Math.ceil((s.z1 - oz) / h));
		const lim = FAR + s.k;
		const step = h * LIPSCHITZ;
		const f = s.f;
		const cut = s.cut;
		const k2 = s.k;
		for (let k = k0; k <= k1; k++) {
			const z = oz + k * h;
			for (let j = j0; j <= j1; j++) {
				const y = oy + j * h;
				let id = i0 + nx * (j + ny * k);
				for (let i = i0; i <= i1; i++, id++) {
					const v = f(ox + i * h, y, z);
					if (v > lim) {
						const m = (v - lim) / step | 0;
						i += m;
						id += m;
						continue;
					}
					d[id] = cut ? smax(d[id], -v, k2) : smin(d[id], v, k2);
				}
			}
		}
	}
	return g;
}
/**
* THE FIELD ITSELF, evaluated exactly at a point, with a uniform grid over the
* parts so it costs a dozen distance functions rather than three hundred.
*
* This exists because of the one thing a voxel grid cannot do, and it is the
* defect the last review read off every close-up: A HAND IS READ BY FEATURES
* SMALLER THAN A VOXEL. A knuckle stands 1.5 mm proud. An interphalangeal crease
* is a 2.4 mm tool sunk under a millimetre. An extensor tendon is a 1.9 mm cord
* whose crown is half a millimetre under the skin. A nail bed is 0.9 mm deep.
* Trilinear interpolation of a 1.5 mm grid is a low-pass filter with its cutoff
* at 3 mm: every one of those was authored, was in the field, and was averaged
* out of the extracted normals before it ever reached a pixel — which is why
* three revisions of "add more anatomy" produced the same smooth grey blob.
*
* So the surface stays where surface nets put it, and the NORMAL is taken from
* the analytic field instead. That is normal mapping, done against the same
* source of truth as the geometry rather than against a texture, and it costs
* one pass over the vertices. Creases, tendons, knuckle folds, nail folds and
* the compression flats where the pads meet the hilt all come back.
*
* Order matters and is preserved: the field is an ordered fold of smin/smax
* from FAR, and a shape contributes nothing outside its own influence box (that
* is exactly how `rasterise` samples it), so replaying only the boxes that
* contain the point, in index order, reproduces the grid bit for bit.
*/
var Field = class {
	shapes;
	cell;
	nx;
	ny;
	nz;
	ox;
	oy;
	oz;
	/** Shape indices per bucket, in ascending index order. */
	buckets;
	constructor(shapes, g) {
		this.shapes = shapes;
		this.cell = Math.max(g.h * 8, .008);
		this.ox = g.ox;
		this.oy = g.oy;
		this.oz = g.oz;
		this.nx = Math.max(1, Math.ceil(g.nx * g.h / this.cell) + 1);
		this.ny = Math.max(1, Math.ceil(g.ny * g.h / this.cell) + 1);
		this.nz = Math.max(1, Math.ceil(g.nz * g.h / this.cell) + 1);
		const lists = [];
		for (let i = 0; i < this.nx * this.ny * this.nz; i++) lists.push([]);
		for (let s = 0; s < shapes.length; s++) {
			const sh = shapes[s];
			const i0 = clamp(Math.floor((sh.x0 - this.ox) / this.cell), 0, this.nx - 1);
			const i1 = clamp(Math.floor((sh.x1 - this.ox) / this.cell), 0, this.nx - 1);
			const j0 = clamp(Math.floor((sh.y0 - this.oy) / this.cell), 0, this.ny - 1);
			const j1 = clamp(Math.floor((sh.y1 - this.oy) / this.cell), 0, this.ny - 1);
			const k0 = clamp(Math.floor((sh.z0 - this.oz) / this.cell), 0, this.nz - 1);
			const k1 = clamp(Math.floor((sh.z1 - this.oz) / this.cell), 0, this.nz - 1);
			for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lists[i + this.nx * (j + this.ny * k)].push(s);
		}
		this.buckets = lists.map((l) => Int32Array.from(l));
	}
	at(x, y, z) {
		const i = clamp(Math.floor((x - this.ox) / this.cell), 0, this.nx - 1);
		const j = clamp(Math.floor((y - this.oy) / this.cell), 0, this.ny - 1);
		const k = clamp(Math.floor((z - this.oz) / this.cell), 0, this.nz - 1);
		const list = this.buckets[i + this.nx * (j + this.ny * k)];
		let d = FAR;
		for (let n = 0; n < list.length; n++) {
			const s = this.shapes[list[n]];
			if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1 || z < s.z0 || z > s.z1) continue;
			const v = s.f(x, y, z);
			d = s.cut ? smax(d, -v, s.k) : smin(d, v, s.k);
		}
		return d;
	}
};
/** Trilinear sample, for normals and for ambient occlusion. */
function fieldAt(g, x, y, z) {
	const fx = (x - g.ox) / g.h;
	const fy = (y - g.oy) / g.h;
	const fz = (z - g.oz) / g.h;
	const i = Math.floor(fx);
	const j = Math.floor(fy);
	const k = Math.floor(fz);
	if (i < 0 || j < 0 || k < 0 || i >= g.nx - 1 || j >= g.ny - 1 || k >= g.nz - 1) return FAR;
	const tx = fx - i;
	const ty = fy - j;
	const tz = fz - k;
	const d = g.d;
	const nx = g.nx;
	const s = nx * g.ny;
	const b = i + nx * (j + g.ny * k);
	const x00 = d[b] + (d[b + 1] - d[b]) * tx;
	const x10 = d[b + nx] + (d[b + nx + 1] - d[b + nx]) * tx;
	const x01 = d[b + s] + (d[b + s + 1] - d[b + s]) * tx;
	const x11 = d[b + s + nx] + (d[b + s + nx + 1] - d[b + s + nx]) * tx;
	const y0 = x00 + (x10 - x00) * ty;
	return y0 + (x01 + (x11 - x01) * ty - y0) * tz;
}
const CORNER = [
	[
		0,
		0,
		0
	],
	[
		1,
		0,
		0
	],
	[
		0,
		1,
		0
	],
	[
		1,
		1,
		0
	],
	[
		0,
		0,
		1
	],
	[
		1,
		0,
		1
	],
	[
		0,
		1,
		1
	],
	[
		1,
		1,
		1
	]
];
const CELL_EDGE = [
	[0, 1],
	[2, 3],
	[4, 5],
	[6, 7],
	[0, 2],
	[1, 3],
	[4, 6],
	[5, 7],
	[0, 4],
	[1, 5],
	[2, 6],
	[3, 7]
];
/**
* Naive surface nets: one vertex per cell the surface crosses, placed at the
* mean of that cell's edge crossings, and a quad round every grid edge that
* changes sign.
*
* Marching cubes would need 4 kB of lookup tables to do the same job with worse
* vertices. Dual vertices land ON the surface and are shared by their four
* quads, so a limb comes out as a smooth tube rather than as the staircase of
* slivers a marching-cubes tube is, and there are half as many of them.
*
* Normals come from the gradient of the FIELD, not from the triangles: that is
* what makes a 1.8 mm mesh shade like a smooth surface, and it is also what
* makes a tendon a millimetre proud of the skin read as a tendon rather than as
* a row of facets. Winding is then fixed per triangle against that normal,
* which removes the one class of bug this kind of code always ships with.
*/
function surfaceNets(g, field) {
	const { nx, ny, nz, h, ox, oy, oz, d } = g;
	const vid = new Int32Array(nx * ny * nz).fill(-1);
	const px = [];
	const v = /* @__PURE__ */ new Float64Array(8);
	/**
	* PER-ROW EXTENT OF THE SOLID, and it is what makes a 1.3 mm grid affordable.
	*
	* A hand's bounding box is ninety per cent air: the fingers are four thin rods
	* with the whole of the space between and around them empty. Walking every
	* cell of that box and reading its eight corners — which is what this did —
	* spends nine tenths of the extraction proving that nothing is there. One
	* single-read pass down each row records where the row is inside skin at all,
	* and both loops below then only visit cells that can possibly straddle the
	* surface. Same output, exactly, to the last vertex.
	*/
	const rows = ny * nz;
	const rowLo = new Int32Array(rows).fill(2147483647);
	const rowHi = new Int32Array(rows).fill(-1);
	for (let r = 0; r < rows; r++) {
		const base = r * nx;
		let lo = 2147483647;
		let hi = -1;
		for (let i = 0; i < nx; i++) if (d[base + i] < 0) {
			if (i < lo) lo = i;
			hi = i;
		}
		rowLo[r] = lo;
		rowHi[r] = hi;
	}
	/**
	* The i-range of cells (i, j, k) whose eight corners could straddle zero: the
	* union of the four rows the cell's corners lie on, widened by one cell either
	* side so a cell adjacent to solid is still visited.
	*/
	const spanLo = new Int32Array(rows);
	const spanHi = new Int32Array(rows);
	for (let k = 0; k + 1 < nz; k++) for (let j = 0; j + 1 < ny; j++) {
		let lo = 2147483647;
		let hi = -1;
		for (let dk = 0; dk < 2; dk++) for (let dj = 0; dj < 2; dj++) {
			const r = j + dj + ny * (k + dk);
			if (rowHi[r] < 0) continue;
			if (rowLo[r] < lo) lo = rowLo[r];
			if (rowHi[r] > hi) hi = rowHi[r];
		}
		const r = j + ny * k;
		spanLo[r] = Math.max(0, lo - 1);
		spanHi[r] = Math.min(nx - 2, hi);
	}
	for (let k = 0; k + 1 < nz; k++) for (let j = 0; j + 1 < ny; j++) {
		const r = j + ny * k;
		const ib = spanHi[r];
		for (let i = spanLo[r]; i <= ib; i++) {
			let neg = 0;
			for (let b = 0; b < 8; b++) {
				const c = CORNER[b];
				const val = d[i + c[0] + nx * (j + c[1] + ny * (k + c[2]))];
				v[b] = val;
				if (val < 0) neg++;
			}
			if (neg === 0 || neg === 8) continue;
			let sx = 0;
			let sy = 0;
			let sz = 0;
			let n = 0;
			for (const e of CELL_EDGE) {
				const a = v[e[0]];
				const b = v[e[1]];
				if (a < 0 === b < 0) continue;
				const t = a / (a - b);
				const ca = CORNER[e[0]];
				const cb = CORNER[e[1]];
				sx += ca[0] + (cb[0] - ca[0]) * t;
				sy += ca[1] + (cb[1] - ca[1]) * t;
				sz += ca[2] + (cb[2] - ca[2]) * t;
				n++;
			}
			vid[i + nx * (j + ny * k)] = px.length / 3;
			px.push(ox + (i + sx / n) * h, oy + (j + sy / n) * h, oz + (k + sz / n) * h);
		}
	}
	const pos = new Float32Array(px);
	const nrm = new Float32Array(px.length);
	/**
	* NORMALS OFF THE ANALYTIC FIELD, at a third of a voxel.
	*
	* The vertex positions still come from the grid — they have to, the mesh is a
	* dual of the grid — but sampling the gradient off that same grid throws away
	* everything the grid could not hold, which on a hand is every crease, every
	* tendon and every knuckle fold (see the note on `Field`). Sampling the field
	* directly at 0.5 mm resolves them all, and the geometry underneath being a
	* little smoother than the shading is exactly the bargain a normal map is.
	*
	* 0.36 of a voxel and not less. The palm is built from nine metacarpal rays
	* joined with a 2.5 mm fillet, and that union scallops by a few tenths of a
	* millimetre between the axes; sampled tighter than the scallop the analytic
	* gradient reads it and the palm comes out CORRUGATED — four raised bands
	* knuckles-to-wrist, which is the bandaged-hand look the fillet radius was
	* chosen to avoid in the first place. This is the low-pass that keeps the
	* authored anatomy and drops the construction.
	*/
	const e = h * .36;
	for (let i = 0; i < pos.length; i += 3) {
		const x = pos[i];
		const y = pos[i + 1];
		const z = pos[i + 2];
		let gx = field.at(x + e, y, z) - field.at(x - e, y, z);
		let gy = field.at(x, y + e, z) - field.at(x, y - e, z);
		let gz = field.at(x, y, z + e) - field.at(x, y, z - e);
		let l = Math.hypot(gx, gy, gz);
		if (l < 1e-9) {
			gx = fieldAt(g, x + h, y, z) - fieldAt(g, x - h, y, z);
			gy = fieldAt(g, x, y + h, z) - fieldAt(g, x, y - h, z);
			gz = fieldAt(g, x, y, z + h) - fieldAt(g, x, y, z - h);
			l = Math.hypot(gx, gy, gz) || 1;
		}
		nrm[i] = gx / l;
		nrm[i + 1] = gy / l;
		nrm[i + 2] = gz / l;
	}
	const tri = [];
	const face = (a, b, c) => {
		if (a < 0 || b < 0 || c < 0) return;
		const ux = pos[b * 3] - pos[a * 3];
		const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
		const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
		const wx = pos[c * 3] - pos[a * 3];
		const wy = pos[c * 3 + 1] - pos[a * 3 + 1];
		const wz = pos[c * 3 + 2] - pos[a * 3 + 2];
		const cx = uy * wz - uz * wy;
		const cy = uz * wx - ux * wz;
		const cz = ux * wy - uy * wx;
		const nx2 = nrm[a * 3] + nrm[b * 3] + nrm[c * 3];
		const ny2 = nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1];
		const nz2 = nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2];
		if (cx * nx2 + cy * ny2 + cz * nz2 >= 0) tri.push(a, b, c);
		else tri.push(a, c, b);
	};
	const cell = (i, j, k) => vid[i + nx * (j + ny * k)];
	for (let k = 1; k + 1 < nz; k++) for (let j = 1; j + 1 < ny; j++) {
		const r = j + ny * k;
		const ia = Math.max(1, spanLo[r]);
		const ib = Math.min(nx - 2, spanHi[r] + 1);
		for (let i = ia; i <= ib; i++) {
			const id = i + nx * (j + ny * k);
			const s0 = d[id] < 0;
			if (i + 2 < nx && s0 !== d[id + 1] < 0) {
				const a = cell(i, j - 1, k - 1);
				const b = cell(i, j, k - 1);
				const c = cell(i, j, k);
				const e2 = cell(i, j - 1, k);
				face(a, b, c);
				face(a, c, e2);
			}
			if (j + 2 < ny && s0 !== d[id + nx] < 0) {
				const a = cell(i - 1, j, k - 1);
				const b = cell(i, j, k - 1);
				const c = cell(i, j, k);
				const e2 = cell(i - 1, j, k);
				face(a, b, c);
				face(a, c, e2);
			}
			if (k + 2 < nz && s0 !== d[id + nx * ny] < 0) {
				const a = cell(i - 1, j - 1, k);
				const b = cell(i, j - 1, k);
				const c = cell(i, j, k);
				const e2 = cell(i - 1, j, k);
				face(a, b, c);
				face(a, c, e2);
			}
		}
	}
	return {
		pos,
		nrm,
		tri: new Uint32Array(tri)
	};
}
/**
* Ambient occlusion straight out of the field: march a few steps along the
* normal and ask how much nearer the surface is than the step you took.
*
* This is the single term that makes a closed hand read as closed. The tunnel
* between the fingers and the haft, the tuck under the thenar and the clefts
* between the fingers get almost no sky and sit two stops below the knuckles
* above them; a tiling detail map cannot know that, and without it every fold
* on a pale grey hand disappears.
*/
function fieldAO(g, x, y, z, nx, ny, nz) {
	let occ = 0;
	let w = 1;
	let sum = 0;
	for (const t of [
		.0035,
		.0075,
		.015,
		.028
	]) {
		const d = fieldAt(g, x + nx * t, y + ny * t, z + nz * t);
		occ += w * Math.max(0, t - d) / t;
		sum += w;
		w *= .62;
	}
	return clamp(1 - occ / sum * .76, .52, 1);
}
/**
* A NAIL IS NOT A SEPARATE OBJECT. It used to be — a `nailPlate()` mesh, a
* hundred lines of doubly-curved shell with a lunula and a free edge, set into
* a dish cut in the fingertip — and that is precisely why no version of it ever
* read as a nail. Two surfaces meeting at a boundary neither of them knows
* about shows the boundary, and at this scale the boundary is bigger than the
* nail. See `seatNail` in `handGeometry`: the plate is now three terms in the
* hand's own distance field and the keratin is a material group over triangles
* of the one shell.
*/
/**
* The wrap frame. The grip runs up +Y; the palm presses on the grip's -X face;
* the thumb's tip comes to rest on -Z. Everything on the hand is placed by an
* angle `th` about the grip axis and a height `y` along it, so "where the
* finger is" and "where the haft surface is" are expressions in the same two
* variables and cannot disagree.
*
* `th` is CLOCKWISE seen from +Y — an angle maps to a position through
* `chainPoint()` and `rad()`, both of which negate the `z`, and that negation
* is the hand's chirality. Read the note on `chainPoint()` before changing
* anything in this section, including a comment: the previous revision had the
* sign the other way and shipped a LEFT hand in the player's right, which
* survived two reviews precisely because every local statement about it was
* true and only the relationship between two of them was wrong.
*
* The palm covers 2.38 radians (136 degrees) of the haft, from the heel of the
* hand at THA round to the metacarpal heads at THB. The fingers continue from
* THB in the same direction and wrap until their pads come back to the near
* side of the palm. The radial — thumb — side of the hand is +Y throughout,
* which is `FY`'s index entry, the thenar, and the sign convention on the
* palm's own wedge, and it does not move when the chirality does.
*/
const THB = 5;
const THA = 2.62;
/**
* How far a fingertip may wrap.
*
* Round a haft it stops just short of the heel of the palm: past that it is
* inside the hand. A CLOSED FIST is the other case — there is no haft, the
* fingers come the whole way round and their pads land ON the palm, a third of
* the way along it, which is where a clenched hand actually puts them. They can
* only be allowed that far because the fist solves its chain against the
* palm's outer surface rather than against the void the palm is built around;
* solved against the void the tips ended up a centimetre inside the heel of the
* hand and came back out through the other side, which is what the first fist
* looked like from behind.
*/
/**
* ...and a THIN grip — a shield's enarme is 26 mm across, a dagger's hilt
* little more — is closer to the fist case than to a broadsword's. Stopping the
* fingers short of the heel there leaves them lying across the strap as four
* parallel bars with their tips in open air, which is what the review saw in
* the block shot. They are allowed a third of a radian PAST the heel so the
* pads land on the palm, exactly as they do on a haft too fat to reach it.
*/
const TH_MAX = THA + Math.PI * 2 + .34;
const TH_MAX_FIST = THA + Math.PI * 2 + .62;
/**
* The wrist section, half-extents: 5.44 cm ACROSS by 3.04 cm THROUGH — a 1.79:1
* ellipse, wide medio-laterally and shallow dorso-volarly.
*
* IT IS 12% NARROWER AND 20% SHALLOWER THAN IT WAS, and that is the single
* number the last review turned on. The palm is 8.3 cm across the metacarpal
* heads; at 6.2 cm the wrist was 75% of it, so the closed fist was no wider
* than the tube it sat on and the mass ordering along the limb was inverted —
* "a fist is always substantially wider and deeper than the wrist", and this
* one was not. At 5.44 the wrist is 65% of the palm and the fist is 1.53x the
* wrist, which is what a tape reads on a real arm.
*
* The aspect went the other way for the same reason: 1.79:1 is the "roughly
* 2:1 width-to-depth" a distal forearm actually has, and a section flatter than
* it is wide-narrow is the one shape a cylinder can never be mistaken for.
*
* The hand's own wrist stub ends here, the forearm's distal blend arrives here
* AND HOLDS, and the stub sleeves over the last centimetre of the forearm, so
* the two surfaces are the same cylinder where they overlap.
*/
const WRIST_RU = .0272;
const WRIST_RV = .0152;
/**
* The CARPAL WAIST: the narrowest section on the whole limb, sitting between
* the metacarpal block and the distal forearm.
*
* A hand does not grow out of a forearm at constant width. It necks IN through
* the carpus — the eight small bones are a tight bundle and there is no muscle
* on them at all — and then flares back OUT into the metacarpal mass and the
* two eminences. That waist plus that flare is what a wrist looks like, and
* without it the distal forearm "flows into the hand as one continuous
* lathe-turned surface", which is exactly what the review saw.
*/
const CARPAL_RU = .0264;
const CARPAL_RV = .0143;
/** How far the hand's own wrist runs back off the heel of the palm. */
const WRIST_LEN = .038;
/**
* Walk a finger round the grip.
*
* Each phalanx is a STRAIGHT bone of a fixed length, so the only unknown is the
* angle it subtends about the grip axis, and the law of cosines gives that
* exactly from the two joint radii and the bone length. Joint radii are the
* haft's own surface radius at that angle plus a standoff — larger at the
* knuckles, which stand proud, and smaller at the tip, whose pad presses in.
* The consequence is the thing the whole rewrite is for: the bone chords sit
* closer to the haft than the joints do, so the pads touch the grip and the
* knuckles do not, on any section, for any weapon, without a number being
* tuned by eye.
*
* The radii feed back into the angles (the haft is a rounded rectangle, so its
* radius depends on where you are round it), which is what the fixed-point loop
* is for; it converges in two passes on any section this game builds.
*/
function wrapChain(gr, th0, y0, dy, lens, radii, stand, thMax) {
	const th = [th0];
	const rho = [gr(th0) + radii[0] * stand[0]];
	for (let k = 0; k < lens.length; k++) {
		let t = th[k] + 1;
		let rk = 0;
		for (let it = 0; it < 4; it++) {
			rk = gr(t) + radii[k + 1] * stand[k + 1];
			const c = clamp((rho[k] * rho[k] + rk * rk - lens[k] * lens[k]) / (2 * rho[k] * rk), -1, 1);
			t = th[k] + Math.acos(c);
		}
		th.push(t);
		rho.push(rk);
	}
	const span = th[th.length - 1] - th0;
	if (span > thMax - th0 && span > 1e-6) {
		const k = (thMax - th0) / span;
		for (let i = 1; i < th.length; i++) {
			th[i] = th0 + (th[i] - th0) * k;
			rho[i] = gr(th[i]) + radii[i] * stand[i];
		}
	}
	let total = 0;
	const cum = [0];
	for (const l of lens) {
		total += l;
		cum.push(total);
	}
	return {
		th,
		rho,
		y: cum.map((c) => y0 + dy * (c / Math.max(total, 1e-6))),
		r: radii.slice()
	};
}
/**
* (angle about the grip axis, radius, height) -> hand space. THE SINGLE PLACE
* THE HAND'S CHIRALITY IS DECIDED, and the reason the `z` is negated.
*
* Every chain in this file flexes by INCREASING `th`, and `FY` puts the radial
* (thumb) side at +Y. Increasing `atan2(z, x)` is a rotation about -Y, so with
* the naive `z = +sin(th) * rho` the fingers flex about an axis pointing at the
* LITTLE finger — which is a left hand, necessarily, whatever the rest of the
* file believes. That is exactly the bug this negation fixes: it was shipped
* for three revisions with the correct-looking comments around it, because
* every statement in isolation was true and only the SIGN RELATIONSHIP between
* two of them was wrong.
*
* With `z = -sin(th) * rho` the MCP flexion axis points at the thumb and the
* hand is right-chiral — see `tools/handedness.mjs`, which measures
* `cross(T,F).N` on the built mesh and must read POSITIVE.
*
* Because it is done here, in the map from angle to position, it costs nothing
* downstream: `wrapChain` solves in (th, rho) and never sees a coordinate, and
* `sweep` decides its winding from the frames it is handed rather than from a
* convention, so every part comes out with its normals still facing outward.
*/
function chainPoint(c, k, out) {
	return out.set(Math.cos(c.th[k]) * c.rho[k], c.y[k], -Math.sin(c.th[k]) * c.rho[k]);
}
/**
* Voxel pitch of the hand field.
*
* 1.8 mm is the coarsest that still holds the things a hand is read by: a
* knuckle stands 1.5 mm proud, a finger crease is 2.5 mm across, a tendon is
* 1.8 mm wide. It puts about eleven cells across a finger and costs ~25 k
* triangles and ~80 ms a hand. Both are cheap here — the hands are cached per
* grip section, they are the most-looked-at surface in the game, and the frame
* they sit in is 14 M triangles.
*/
const HAND_H = .0012;
/**
* A RIGHT hand closed on a grip of the given section — and it is measurably a
* right hand: `tools/handedness.mjs` builds this exact function, takes the
* three anatomical axes off the solved bones and independently off the vertex
* buffer, and reports `cross(T,F).N`, which must be POSITIVE. Run it after any
* change in here. It read -0.996 for three revisions.
*
* Every part below is a distance, and they are joined with a fillet rather than
* concatenated as triangle lists — see the note on `Skin`. That is the whole
* difference between a hand and a bag of primitives, and it is why the thenar
* is a swelling of the palm rather than a ball on it, why two fingers pressed
* together share a crease rather than a gap, and why a fist is solid.
*
* `fist` closes it on a fist-sized void instead of a haft, fills that void, and
* re-aims the wrist so the forearm runs through the KNUCKLES rather than down
* the tunnel of the fist, which is the whole difference between a grip and a
* punch.
*/
function handGeometry(grip, fist = false, lift = 0) {
	const GN = 4;
	const gr = (th) => sectionRadius(th, grip.x, grip.z, GN);
	const rad = (th) => new Vector3(Math.cos(th), 0, -Math.sin(th));
	const tan = (th) => new Vector3(-Math.sin(th), 0, -Math.cos(th));
	const YA = new Vector3(0, 1, 0);
	const key = (a, s) => {
		const f = clamp(s, 0, 1) * (a.length - 1);
		const i = Math.min(a.length - 2, Math.floor(f));
		return a[i] + (a[i + 1] - a[i]) * (f - i);
	};
	const skin = new Skin();
	const warm = [];
	/** Where the skin's grain goes coarse: knuckles, and the dorsum over them. */
	const coarse = [];
	const A = new Vector3();
	const B = new Vector3();
	const YC = [
		-.014,
		-.004,
		.01,
		.024,
		.032
	];
	const HY = [
		.0326,
		.0362,
		.04,
		.043,
		.0416
	];
	const TH = [
		.033,
		.035,
		.036,
		.031,
		.024
	];
	/**
	* Thickness of a metacarpal ray as a fraction of the block's, across the hand
	* — `yn` = 0 is the fifth ray on the ulnar border, 1 is the second, under the
	* thumb. THIS IS THE TRANSVERSE ARCH and it is not a linear ramp.
	*
	* A palm is not a wedge that thins evenly from thumb to little finger: the
	* second and third metacarpals are the deepest and the most dorsally
	* prominent, the fourth falls away, and the fifth is HALF the depth of the
	* second and sits distinctly lower. Ramping linearly from 0.62 to 1.0, which
	* is what this was, puts the peak of the arch on the very edge of the block
	* where the thenar covers it anyway, so nothing about the arch is visible and
	* the four finger rolls come off "a flat plate as parallel grooves of equal
	* width and equal depth" — the review's words, and a fair reading of what a
	* linear ramp draws.
	*
	* Keyed at 0.50 / 0.68 / 0.88 / 1.00 / 0.96 the crown sits over the second
	* and third rays, the ulnar border genuinely thins to half, and the section
	* across the knuckles is a curve with a high side and a low side.
	*/
	const RAYT = [
		.5,
		.68,
		.88,
		1,
		.96
	];
	const rayR = (s, yn) => key(TH, s) * .5 * key(RAYT, yn);
	const rayY = (s, yn) => key(YC, s) + (2 * yn - 1) * (key(HY, s) - rayR(s, yn));
	const rayP = (s, yn) => {
		const th = THA + 2.38 * s;
		return rad(th).multiplyScalar(gr(th) + rayR(s, yn)).setY(rayY(s, yn));
	};
	/**
	* NINE rays and a 2.5 mm fillet, and both numbers matter for the same reason:
	* A SMOOTH MINIMUM PUSHES THE SURFACE OUT BY k/4 ALONG EVERY SEAM.
	*
	* That is not a defect of the operator, it is what a fillet IS, and it is the
	* single easiest way to wreck a field. Nine tubes 8 mm apart scallop inward by
	* about 0.6 mm between their axes; joined at the 13 mm the first pass used,
	* the fillet pushed 3.2 mm back out along each of those valleys and the palm
	* came out CORRUGATED — four raised bands running knuckles to wrist, which in
	* a render is indistinguishable from a bandage wrapped round the hand. Matched
	* against the scallop it leaves, the union is flat to a tenth of a millimetre.
	*
	* The rule for the rest of this function: a big fillet ONLY where two
	* different structures meet and a soft transition is the anatomy (thenar into
	* palm, wrist into palm, thumb out of thenar). Parts of one structure that
	* already overlap get almost none.
	*/
	const NR = 9;
	const PSTEP = 9;
	const S0 = .04;
	for (let jr = 0; jr < NR; jr++) {
		const yn = jr / 8;
		let pa = rayP(S0, yn);
		let ra = rayR(S0, yn);
		for (let i = 1; i <= PSTEP; i++) {
			const s = S0 + .83 * (i / PSTEP);
			const pb = rayP(s, yn);
			const rb = rayR(s, yn);
			skin.limb(pa, pb, ra, rb, YA, 1, 1, .0025);
			pa = pb;
			ra = rb;
		}
	}
	const wrapR = (th) => {
		const s = ((th - THA) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) / 2.38;
		const fade = s <= 1 ? 1 : Math.max(0, 1 - (s - 1) * .9);
		const c = clamp(s, 0, 1);
		return gr(th) + fade * 2 * rayR(c, .55);
	};
	const FY = [
		.0625,
		.0405,
		.018,
		-.0035
	];
	const FL = [
		.1015,
		.1085,
		.0995,
		.079
	];
	const FR = [
		.0099,
		.0103,
		.0094,
		.0079
	];
	const FT = [
		.007,
		.0072,
		.0066,
		.0056
	];
	const FTH0 = [
		4.945,
		4.99,
		4.915,
		4.73
	];
	const FSTAND = [
		2.05,
		2,
		1.9,
		1.78
	];
	const FDY = [
		-.009,
		-.003,
		.004,
		.011
	];
	const chains = [];
	for (let f = 0; f < 4; f++) {
		const L = FL[f] * (fist ? .99 : 1);
		const lens = [
			L * .47,
			L * .31,
			L * .22
		];
		const r0 = FR[f];
		const radii = [
			r0,
			r0 * .92,
			r0 * .84,
			FT[f]
		];
		const stand = [
			FSTAND[f],
			1.3,
			1.14,
			.8
		];
		chains.push(wrapChain(wrapR, FTH0[f], FY[f], FDY[f], lens, radii, stand, fist ? TH_MAX_FIST : TH_MAX));
	}
	const idx0 = chains[0];
	const midA = chainPoint(idx0, 1, new Vector3());
	const midB = chainPoint(idx0, 2, new Vector3());
	const cross = midA.clone().lerp(midB, .45);
	const crossTh = Math.atan2(-cross.z, cross.x);
	const crossRho = Math.hypot(cross.x, cross.z);
	/**
	* Thumb bone radii, and they do NOT run down like a finger's.
	*
	* A thumb is the SHORT BROAD digit: two phalanges to a finger's three, both of
	* them stubby, and the distal one wider than the middle bone of the index it
	* lies against. The review found "no articulated thumb on the radial side at
	* all — the radial half of the fist is one smooth undifferentiated mass with
	* no MCP knuckle, no IP crease, and no distal pad", and on the shield "an
	* untapered extruded horn of finger length and diameter". Both of those come
	* out of the same mistake: building the thumb as a fourth finger with a
	* different root. It is not one. It is 15% fatter at every station, it is
	* shorter, and it barely tapers at all until the last bone.
	*/
	const TR = [
		.014,
		.0128,
		.0118,
		.0104
	];
	const tk = {
		th: [
			2.9,
			2.1399999999999997,
			crossTh + (fist ? .5 : .36) + Math.PI * 2,
			crossTh + Math.PI * 2
		],
		rho: [
			gr(2.9) + .024,
			gr(2.1399999999999997) + TR[1] * 1.05,
			crossRho + FR[0] * .55 + TR[2] * .92,
			crossRho + FR[0] * .8 + TR[3] * .78
		],
		y: [
			.014,
			.04,
			cross.y - .007,
			cross.y + .003
		],
		r: TR
	};
	while (tk.th[1] > tk.th[0]) tk.th[1] -= Math.PI * 2;
	while (tk.th[2] > tk.th[1]) tk.th[2] -= Math.PI * 2;
	while (tk.th[3] > tk.th[2]) tk.th[3] -= Math.PI * 2;
	const heel = rad(THA).multiplyScalar(gr(THA) + key(TH, 0) * .5).setY(YC[0]);
	const wristDir = rad(THA).multiplyScalar(.62).setY(-.78).normalize().addScaledVector(tan(THA), -.11).normalize();
	const P0 = heel.clone();
	const P1 = heel.clone().addScaledVector(tan(THA), -.014);
	const P3 = heel.clone().addScaledVector(wristDir, .054);
	const P2 = P3.clone().addScaledVector(wristDir, -.026);
	/** Where along the sweep the forearm's tip lands, and the sleeve begins. */
	const TJ = WRIST_LEN / .054;
	const bez = (t) => {
		const s = 1 - t;
		return new Vector3().addScaledVector(P0, s * s * s).addScaledVector(P1, 3 * s * s * t).addScaledVector(P2, 3 * s * t * t).addScaledVector(P3, t * t * t);
	};
	/**
	* Half-extents down the stub, and THIS IS THE CARPUS.
	*
	* The old profile ran 3.22 -> 3.09 cm across: a 4% change over the whole
	* wrist, which is a constant-section tube with a smoothstep on it. The review
	* measured it off the render — "the width at the 'wrist' equals the width of
	* the hand, so the arm reads as a rubber chair leg with a knob glued on" —
	* and it was right.
	*
	* What is authored now is the three-part form a real wrist has:
	*
	*   0.00  3.35 x 2.00   the heel of the palm, still carrying metacarpal mass
	*   0.46  2.64 x 1.43   THE WAIST — 65% of the 8.3 cm palm, 1.85:1 flat
	*   0.62  2.70 x 1.50   the flare back out over the two styloids
	*   0.70  2.72 x 1.52   the forearm's own distal section, arrived at exactly
	*
	* — a 21% neck-down in width and 28% in depth, then a re-widening. Both the
	* narrowing and the flare have to be there: a wrist that only narrows is a
	* neck, and a neck on a limb is a bottle.
	*/
	const WSEC_U = [
		[0, .0335],
		[.24, .0298],
		[.46, CARPAL_RU],
		[.62, .027],
		[.7, WRIST_RU]
	];
	const WSEC_V = [
		[0, .02],
		[.24, .0172],
		[.46, CARPAL_RV],
		[.62, .015],
		[.7, WRIST_RV]
	];
	const wsec = (t) => {
		const tuck = 1 - .12 * clamp((t - TJ) / .2962962962962963, 0, 1) ** .8;
		return {
			ru: curve(WSEC_U, t) * tuck,
			rv: curve(WSEC_V, t) * tuck
		};
	};
	const WN = 12;
	{
		let pa = bez(0);
		let sa = wsec(0);
		for (let i = 1; i <= WN; i++) {
			const t = i / WN;
			const pb = bez(t);
			const sb = wsec(t);
			skin.limb(pa, pb, sa.rv, sb.rv, YA, sa.ru / sa.rv, 1, i === 1 ? .016 : .0012);
			pa = pb;
			sa = sb;
		}
	}
	{
		const dorU = rad(THA).addScaledVector(YA, -.88).normalize();
		const c = bez(.6).addScaledVector(dorU, .013);
		skin.limb(c.clone().addScaledVector(wristDir, -.004), c.clone().addScaledVector(wristDir, .0035), .007, .0066, YA, 1, .92, .0055);
		const h = bez(.44).addScaledVector(dorU, .0175);
		skin.limb(h.clone().addScaledVector(YA, -.003), h.clone().addScaledVector(YA, .008), .0016, .0015, dorU, 1, 1, .0016, true);
		const dorR = rad(THA).addScaledVector(YA, .84).normalize();
		const c2 = bez(.42).addScaledVector(dorR, .0122);
		skin.limb(c2.clone().addScaledVector(wristDir, -.003), c2.clone().addScaledVector(wristDir, .003), .006, .0058, YA, 1, 1, .005);
	}
	const thenarA = rad(2.88).multiplyScalar(gr(2.88) + .016).setY(.026);
	chainPoint(tk, 1, B);
	const thenarB = B.clone().lerp(thenarA, .18);
	skin.limb(thenarA, thenarB, .018, .0132, YA, 1.06, 1, .015);
	const hypoA = rad(2.8400000000000003).multiplyScalar(gr(2.8400000000000003) + .013).setY(rayY(.05, 0) + .011);
	const hypoB = rad(4.3).multiplyScalar(gr(4.3) + .012).setY(FY[3] - .004);
	skin.limb(hypoA, hypoB, .0148, .0102, YA, 1, 1, .018);
	for (const [t, d] of [
		[.46, .0022],
		[.56, .0016],
		[.65, .0013]
	]) {
		const c = bez(t);
		const volar = rad(THA).multiplyScalar(-1);
		const s = wsec(t);
		const cc = c.clone().addScaledVector(volar, s.rv + d * .3);
		skin.limb(cc.clone().addScaledVector(YA, -s.ru), cc.clone().addScaledVector(YA, s.ru), d, d, volar, 1, 1, .0022, true);
	}
	const p = new Parts();
	new Matrix4();
	new Quaternion();
	new Vector3(1, 1, 1);
	const nailBoxes = [];
	/** Section depth of both the trough and the plate: a slab, not a rod. */
	const NAIL_D = .34;
	const seatNail = (c, w, len, deep) => {
		const d0 = chainPoint(c, 2, new Vector3());
		const d1 = chainPoint(c, 3, new Vector3());
		const nt = new Vector3().subVectors(d1, d0);
		const nl = Math.max(nt.length(), 1e-5);
		nt.divideScalar(nl);
		const nv = new Vector3(d0.x + d1.x, 0, d0.z + d1.z).normalize();
		nv.addScaledVector(nt, -nv.dot(nt));
		if (nv.lengthSq() < 1e-8) return;
		nv.normalize();
		const nu = new Vector3().crossVectors(nv, nt);
		const L = Math.min(len, nl * .72);
		const s0 = nl * .1;
		const base = d0.clone().addScaledVector(nt, s0);
		const rB = c.r[2] * deep;
		const rT = c.r[3] * deep;
		const o0 = rB + (rT - rB) * (s0 / nl);
		const o1 = (rB + (rT - rB) * ((s0 + L) / nl)) * .9;
		/**
		* How deep the bed is sunk below the finger's own dorsal surface — and it
		* has to be MORE than one voxel or the extraction rounds the whole fold off
		* and the nail becomes a slightly shinier patch of finger, which is what
		* every previous seating produced. 1.8 mm of trough with a 1.4 mm plate in
		* it leaves the plate 0.4 mm below the surrounding skin, which is where a
		* real nail sits, and leaves a groove the mesh can actually hold.
		*/
		const sink = .0018;
		const tr0 = w * 1.16;
		const tr1 = w * 1.34;
		skin.limb(base.clone().addScaledVector(nv, o0 - sink + NAIL_D * tr0), base.clone().addScaledVector(nt, L * .88).addScaledVector(nv, o1 - sink + NAIL_D * tr1), tr0, tr1, nu, 1, NAIL_D, 8e-4, true);
		const pr0 = w * .82;
		const pr1 = w * 1;
		const rise = .0014;
		skin.limb(base.clone().addScaledVector(nv, o0 - sink + rise - NAIL_D * pr0), base.clone().addScaledVector(nt, L).addScaledVector(nv, o1 - sink + rise - NAIL_D * pr1), pr0, pr1, nu, 1, NAIL_D, 7e-4);
		nailBoxes.push({
			o: base.clone(),
			t: nt.clone(),
			v: nv.clone(),
			u: nu.clone(),
			len: L,
			hw: w * 1.02,
			floor: o0 - sink - 4e-4
		});
	};
	for (let f = 0; f < 4; f++) {
		const c = chains[f];
		for (let j = 0; j < 3; j++) {
			chainPoint(c, j, A);
			chainPoint(c, j + 1, B);
			const wide = j === 2 ? 1.3 : 1.14;
			const deep = j === 2 ? .78 : .92;
			skin.limb(A.clone(), B.clone(), c.r[j], c.r[j + 1], YA, wide, deep, j === 0 ? .005 : .0015);
		}
		for (let j = 0; j <= 2; j++) {
			chainPoint(c, j, A);
			chainPoint(c, j + 1, B);
			const along = B.clone().sub(A).normalize();
			const dor = new Vector3(A.x, 0, A.z).normalize();
			const kr = c.r[j] * (j === 0 ? 1.22 : 1.14);
			const off = c.r[j] * .14;
			const cc = A.clone().addScaledVector(dor, off);
			skin.limb(cc.clone().addScaledVector(YA, -.0016), cc.clone().addScaledVector(YA, .0016), kr, kr, dor, 1, .88, .003);
			coarse.push({
				c: cc.clone().addScaledVector(dor, kr * .7),
				reach: kr * 2.4
			});
			for (const [dx, d] of [
				[-.0038, .0011],
				[-8e-4, .0013],
				[.0026, .001]
			]) {
				const hgt = off + Math.sqrt(Math.max(kr * kr - dx * dx, 0));
				const cw = A.clone().addScaledVector(along, dx).addScaledVector(dor, hgt + d * .42);
				skin.limb(cw.clone().addScaledVector(YA, -c.r[j] * 1.35), cw.clone().addScaledVector(YA, c.r[j] * 1.35), d, d, dor, 1, 1, .001, true);
			}
		}
		for (let j = 1; j <= 2; j++) {
			chainPoint(c, j, A);
			const dor = new Vector3(A.x, 0, A.z).normalize();
			const cc = A.clone().addScaledVector(dor, -c.r[j] * .86);
			skin.limb(cc.clone().addScaledVector(YA, -c.r[j] * 1.5), cc.clone().addScaledVector(YA, c.r[j] * 1.5), .002, .002, dor, 1, 1, .0018, true);
		}
		chainPoint(c, 3, A);
		warm.push({
			c: A.clone(),
			reach: .03,
			k: .95
		});
		if (fist) continue;
		seatNail(c, FT[f] * .8, FT[f] * 1.95, .78);
	}
	for (let f = 0; f + 1 < 4; f++) {
		const ca = chains[f];
		const cb = chains[f + 1];
		let pa = null;
		for (let j = 0; j <= 3; j++) {
			chainPoint(ca, j, A);
			chainPoint(cb, j, B);
			const mid = A.clone().lerp(B, .5);
			if (pa !== null) {
				const r = .0013 + 7e-4 * j;
				skin.limb(pa, mid, r, r + 3e-4, YA, 1, 1, .0025, true);
			}
			pa = mid;
			if (j === 0) warm.push({
				c: mid.clone(),
				reach: .021,
				k: 1
			});
		}
	}
	const thumbK = [
		.01,
		.005,
		.003
	];
	for (let j = 0; j < 3; j++) {
		chainPoint(tk, j, A);
		chainPoint(tk, j + 1, B);
		const wide = j === 2 ? 1.34 : 1.08;
		const deep = j === 2 ? .74 : .92;
		skin.limb(A.clone(), B.clone(), TR[j], TR[j + 1], YA, wide, deep, thumbK[j]);
	}
	for (const [j, kf] of [[1, 1.16], [2, 1.09]]) {
		chainPoint(tk, j, A);
		const dor = new Vector3(A.x, 0, A.z).normalize();
		const kr = TR[j] * kf;
		const cc = A.clone().addScaledVector(dor, TR[j] * .14);
		skin.limb(cc.clone().addScaledVector(YA, -.0018), cc.clone().addScaledVector(YA, .0018), kr, kr, dor, 1, .88, .005);
		coarse.push({
			c: cc.clone().addScaledVector(dor, kr * .7),
			reach: kr * 2.4
		});
	}
	for (const j of [1, 2]) {
		chainPoint(tk, j, A);
		const dor = new Vector3(A.x, 0, A.z).normalize();
		const cc = A.clone().addScaledVector(dor, -TR[j] * .92);
		skin.limb(cc.clone().addScaledVector(YA, -TR[j] * 1.6), cc.clone().addScaledVector(YA, TR[j] * 1.6), .0021, .0021, dor, 1, 1, .0025, true);
	}
	const thumbTip = chainPoint(tk, 3, new Vector3());
	warm.push({
		c: thumbTip.clone(),
		reach: .032,
		k: .95
	});
	seatNail(tk, TR[3] * .86, TR[3] * 1.6, .74);
	{
		const webTh = 2.52;
		warm.push({
			c: rad(webTh).multiplyScalar(gr(webTh) + .026).setY(.04),
			reach: .03,
			k: .85
		});
	}
	const tendYn = [
		.98,
		.71,
		.42,
		.11
	];
	for (let f = 0; f < 4; f++) {
		const yn = tendYn[f];
		let pa = null;
		for (let i = 0; i <= 3; i++) {
			const s = .18 + i / 3 * .76;
			const th = THA + 2.38 * s;
			const pb = rad(th).multiplyScalar(gr(th) + 2 * rayR(s, yn) - .0024).setY(rayY(s, yn));
			if (pa !== null) skin.limb(pa, pb, .0019, .0019, YA, 1.6, 1, .005);
			pa = pb;
		}
	}
	for (const [yn, ph] of [[.3, .7], [.62, 2.4]]) {
		let pa = null;
		for (let i = 0; i <= 3; i++) {
			const s = .22 + i / 3 * .52;
			const w = yn + Math.sin(ph + s * 6.1) * .1;
			const th = THA + 2.38 * s;
			const pb = rad(th).multiplyScalar(gr(th) + 2 * rayR(s, w) - .0016).setY(rayY(s, w));
			if (pa !== null) skin.limb(pa, pb, .0014, .0014, YA, 1.3, 1, .004);
			pa = pb;
		}
	}
	if (fist) {
		const XA = new Vector3(1, 0, 0);
		const core = grip.z * .94;
		const wide = grip.x / grip.z;
		skin.limb(new Vector3(0, -.038, 0), new Vector3(0, -.01, 0), .006, core, XA, wide, 1, .004);
		skin.limb(new Vector3(0, -.01, 0), new Vector3(0, .048, 0), core, core, XA, wide, 1, .004);
		skin.limb(new Vector3(0, .048, 0), new Vector3(0, .082, 0), core, .005, XA, wide, 1, .004);
		for (const [th, rr] of [
			[2.88, .0125],
			[3.2, .0118],
			[3.48, .0106],
			[3.7800000000000002, .0092]
		]) {
			const R = gr(th) + .016;
			skin.limb(rad(th).multiplyScalar(R).setY(-.03), rad(th).multiplyScalar(R).setY(.064), rr, rr, YA, 1, 1, .014);
		}
	}
	if (!fist) skin.prism(grip.x, grip.z, GN, -.09, .13, .003);
	const grid = rasterise(skin.shapes, HAND_H);
	const net = surfaceNets(grid, new Field(skin.shapes, grid));
	const vcount = net.pos.length / 3;
	const P = Array.from(net.pos);
	const N = Array.from(net.nrm);
	const C = [];
	const T = [];
	const SK = [];
	for (let i = 0; i < vcount; i++) {
		const x = net.pos[i * 3];
		const y = net.pos[i * 3 + 1];
		const z = net.pos[i * 3 + 2];
		T.push(Math.atan2(-z, x) / (Math.PI * 2));
		const ao = fieldAO(grid, x, y, z, net.nrm[i * 3], net.nrm[i * 3 + 1], net.nrm[i * 3 + 2]);
		let r = Math.pow(ao, 1.04);
		let g = Math.pow(ao, 1.1);
		let b = Math.pow(ao, .94);
		let k = 0;
		for (const w of warm) {
			const t = clamp(1 - Math.hypot(x - w.c.x, y - w.c.y, z - w.c.z) / w.reach, 0, 1);
			k = Math.max(k, t * t * w.k);
		}
		r *= 1 + k * .3;
		g *= 1 - k * .1;
		b *= 1 - k * .04;
		C.push(r, g, b);
		let dens = 0;
		for (const c2 of coarse) {
			const t = clamp(1 - Math.hypot(x - c2.c.x, y - c2.c.y, z - c2.c.z) / c2.reach, 0, 1);
			dens = Math.max(dens, t * t);
		}
		SK.push(k, .3 + .7 * dens);
	}
	const tri = Array.from(net.tri);
	const dup = /* @__PURE__ */ new Map();
	for (let t = 0; t < tri.length; t += 3) {
		const ta = T[tri[t]];
		const tb = T[tri[t + 1]];
		const tc = T[tri[t + 2]];
		if (Math.max(ta, tb, tc) - Math.min(ta, tb, tc) <= .5) continue;
		for (let e = 0; e < 3; e++) {
			const v = tri[t + e];
			if (T[v] >= 0) continue;
			let d = dup.get(v);
			if (d === void 0) {
				d = P.length / 3;
				P.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
				N.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
				C.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]);
				SK.push(SK[v * 2], SK[v * 2 + 1]);
				T.push(T[v] + 1);
				dup.set(v, d);
			}
			tri[t + e] = d;
		}
	}
	const uv = [];
	for (let i = 0; i < T.length; i++) uv.push(T[i] * 6, P[i * 3 + 1] * 30);
	const shell = new BufferGeometry();
	shell.setAttribute("position", new Float32BufferAttribute(P, 3));
	shell.setAttribute("normal", new Float32BufferAttribute(N, 3));
	shell.setAttribute("uv", new Float32BufferAttribute(uv, 2));
	shell.setAttribute("color", new Float32BufferAttribute(C, 3));
	shell.setAttribute("askin", new Float32BufferAttribute(SK, 2));
	shell.setIndex(tri);
	/**
	* Which triangles of the one shell are KERATIN. A triangle is nail if its
	* centroid lies inside the plate's own frame — within its half-width, along
	* its length, and above the floor of the trough it sits in. Classifying the
	* centroid rather than the vertices puts the boundary exactly in the fold
	* groove, which is where the material change belongs and is also the only
	* place on the surface where a hard edge between two groups cannot show.
	*/
	const triSlot = new Uint8Array(tri.length / 3);
	if (nailBoxes.length > 0) {
		const cen = new Vector3();
		for (let t = 0; t < tri.length; t += 3) {
			cen.set((P[tri[t] * 3] + P[tri[t + 1] * 3] + P[tri[t + 2] * 3]) / 3, (P[tri[t] * 3 + 1] + P[tri[t + 1] * 3 + 1] + P[tri[t + 2] * 3 + 1]) / 3, (P[tri[t] * 3 + 2] + P[tri[t + 1] * 3 + 2] + P[tri[t + 2] * 3 + 2]) / 3);
			for (const nb of nailBoxes) {
				const dx = cen.x - nb.o.x;
				const dy = cen.y - nb.o.y;
				const dz = cen.z - nb.o.z;
				const at = dx * nb.t.x + dy * nb.t.y + dz * nb.t.z;
				if (at < -8e-4 || at > nb.len) continue;
				const au = dx * nb.u.x + dy * nb.u.y + dz * nb.u.z;
				if (au < -nb.hw || au > nb.hw) continue;
				if (dx * nb.v.x + dy * nb.v.y + dz * nb.v.z < nb.floor) continue;
				triSlot[t / 3] = SLOT_NAIL;
				break;
			}
		}
	}
	p.add(shell, void 0, SLOT_SKIN, void 0, triSlot);
	const geo = p.build();
	if (lift !== 0) {
		geo.applyMatrix4(new Matrix4().makeTranslation(0, lift, 0));
		heel.y += lift;
	}
	const wrist = heel.clone().addScaledVector(wristDir, WRIST_LEN);
	const axis = wristDir.clone();
	const ulnar = new Vector3(0, -1, 0);
	if (fist) {
		const knuckles = new Vector3();
		const kp = new Vector3();
		for (const c of chains) knuckles.add(chainPoint(c, 0, kp));
		knuckles.multiplyScalar(1 / chains.length);
		knuckles.y += lift;
		const punch = knuckles.clone().sub(wrist).normalize();
		const ez = rad(THB);
		ez.addScaledVector(punch, -ez.dot(punch)).normalize();
		const ex = new Vector3().crossVectors(punch, ez);
		const R = new Matrix4().makeBasis(ex, punch, ez).invert();
		geo.applyMatrix4(R);
		wrist.applyMatrix4(R);
		ulnar.transformDirection(R);
		axis.transformDirection(R);
		geo.applyMatrix4(new Matrix4().makeTranslation(-wrist.x, -wrist.y, -wrist.z));
		wrist.set(0, 0, 0);
		geo.computeBoundingSphere();
	}
	const index = geo.getIndex();
	return {
		geo,
		wrist,
		axis,
		ulnar,
		triangles: index === null ? 0 : index.count / 3
	};
}
/**
* A round shield: domed face, raised boss, rolled rim, and the enarmes on the
* back. Built facing +Z with the grip at the origin so it can be placed by a
* hand transform directly.
*/
function shieldGeometry(radius) {
	const p = new Parts();
	const m = new Matrix4();
	const R = radius;
	const lathe = new LatheGeometry([
		[0, .055],
		[.026, .052],
		[.04, .039],
		[.048, .032],
		[R * .45, .024],
		[R * .85, .011],
		[R, 0],
		[R, -.02],
		[R * .9, -.026],
		[R * .4, -.028],
		[.048, -.026],
		[0, -.024]
	].map(([r, y]) => new Vector2(Math.max(1e-4, r), y)), 16);
	lathe.computeVertexNormals();
	m.makeRotationX(Math.PI / 2);
	m.setPosition(0, 0, .055);
	p.add(lathe, m);
	for (const y of [-.07, .07]) {
		const strap = new BoxGeometry(.185, SHIELD_GRIP.z * 2, SHIELD_GRIP.x * 2);
		m.makeTranslation(0, y, .018);
		p.add(strap, m);
	}
	const g = p.build();
	const pos = g.getAttribute("position");
	const uv = g.getAttribute("uv");
	for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 5, pos.getY(i) * 5);
	return g;
}
/**
* The enarme's section, in the same terms a weapon grip reports — and it is a
* STRAP, not a string.
*
* 26 mm by 23 mm was a bootlace, and a hand closed on a bootlace is a hand
* closed on nothing: the four chains wrapped so far round that they piled onto
* each other, the fillets fused them, and what came out was the mitten with a
* horn on it that the review found in the block shot. A real shield enarme is a
* doubled leather band you can get a whole fist through — 38 mm across and 28
* through — and at that section the fingers wrap it the way they wrap a
* warhammer haft, which is a shape this file already gets right.
*
* `shieldGeometry` builds the drawn straps from these same two numbers, so the
* strap the fingers close on and the strap that is drawn cannot disagree.
*/
const SHIELD_GRIP = {
	x: .019,
	z: .014
};
/**
* How far up the haft a hand sits from the anchor. The anchor is the bottom of
* the grip and a pommel lives below it; a hand centred on the anchor buries its
* heel in that pommel — which it still was, by six millimetres: the capture set
* showed a pale wedge of hypothenar inside the black pommel casting on every
* sword frame. The hand's heel now clears the pommel's top ring.
*/
const GRIP_LIFT = .034;
/**
* What a bare fist closes on.
*
* SMALL, and that is a change of mind the field made possible. Every earlier
* version solved the fist round an 18 x 15 mm void because a smaller one drove
* the four chains into each other and the lofted shells came out as a shapeless
* lump of interpenetrating tubes. A field does not care: overlapping shapes
* merge, they do not tangle. So the void can be what a real clenched hand
* actually keeps — 13 x 11, the fingertips almost onto the palm — and the fist
* closes to a solid mass with a 10 mm tunnel instead of a 36 mm one. Fifteen
* millimetres of that difference is the black eyelet the last three passes kept
* showing through the middle of the hand.
*/
const FIST_GRIP = {
	x: .0128,
	z: .0106
};
/**
* A 128x128 tiling detail set for skin: pores, a coarser mottle, and fine hair
* laid in one direction so a forearm is not as smooth as a palm. Grey albedo so
* the race tint lives in the material colour, and a roughness that breaks up
* along the same field — enough that a hand at 40 cm is not a flat plastic
* shape, which is the whole reason it is here rather than a bare colour.
*/
function skinTextures() {
	const N = 192;
	const h = /* @__PURE__ */ new Float32Array(36864);
	/** Dermal mottle, on its own coprime period so it never locks to the pores. */
	const mot = /* @__PURE__ */ new Float32Array(36864);
	/** The crease lattice on its own, because it darkens as well as displaces. */
	const crs = /* @__PURE__ */ new Float32Array(36864);
	const hash = (x, y) => {
		const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
		return s - Math.floor(s);
	};
	const vnoise = (x, y, period) => {
		const xi = Math.floor(x);
		const yi = Math.floor(y);
		const xf = x - xi;
		const yf = y - yi;
		const u = xf * xf * (3 - 2 * xf);
		const v = yf * yf * (3 - 2 * yf);
		const w = (a, b) => hash((a % period + period) % period, (b % period + period) % period);
		return w(xi, yi) * (1 - u) * (1 - v) + w(xi + 1, yi) * u * (1 - v) + w(xi, yi + 1) * (1 - u) * v + w(xi + 1, yi + 1) * u * v;
	};
	/**
	* The crease network, and it is what was missing.
	*
	* Skin at forty centimetres is not pebbled. Its dominant micro-structure is
	* the fine DIAMOND LATTICE of tension lines — two families of shallow
	* grooves crossing at a narrow angle, wandering, a millimetre or so apart,
	* with the flat lozenges of skin between them. That lattice is why a real
	* forearm scatters light in a direction and why the previous surface, which
	* was three octaves of isotropic lump, read as ORANGE PEEL: a uniform field
	* of round bumps at one scale is stucco, on a hand or on a wall.
	*
	* A groove also behaves better than a bump under mips. The lattice survives
	* as a directional darkening when it stops being resolved; a bump field
	* averages to flat and takes the whole surface's character with it, which is
	* why the arm went to putty the moment it was more than a metre away.
	*/
	const lattice = (x, y, ax, ay, scale, seed) => {
		/**
		* WANDER, and it is what stops this being cloth.
		*
		* Two families of evenly spaced lines crossing at a fixed angle is the
		* definition of a WEAVE, and the last review read it off the forearm exactly
		* that way: "a grain texture on the forearm — but that grain reads as woven
		* cloth, not skin". The families were right; the regularity was not. Real
		* tension lines wander by more than their own spacing, so no two lozenges
		* are the same size or the same shape and the eye never finds the warp.
		*
		* Two octaves of offset totalling about five line-widths, on periods coprime
		* with the lines' own, and each family drifting in ANGLE as well — which is
		* the term that kills the last of the plaid, because a constant crossing
		* angle is legible even when the spacing is not.
		*/
		const w = (vnoise(x * .085 + seed, y * .071 - seed, 47) - .5) * 3.6 + (vnoise(x * .24 - seed, y * .21 + seed, 91) - .5) * 1.5;
		const bend = (vnoise(x * .043 - seed * 2, y * .037 + seed * 2, 29) - .5) * .42;
		const s = (x * (ax + bend * ay) + y * (ay - bend * ax)) * scale + w;
		return (1 - Math.abs(s - Math.round(s)) * 2) ** 3;
	};
	for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
		const pores = vnoise(x * 1.05, y * 1.05, 202) * .42 + vnoise(x * 2.6, y * 2.6, 499) * .26 + vnoise(x * 5.3, y * 5.3, 1017) * .15;
		const mottle = vnoise(x * .19, y * .23, 37) * .7 + vnoise(x * .41, y * .37, 79) * .3;
		const cre = lattice(x, y, .94, .34, .3, 3.1) + lattice(x, y, .88, -.47, .215, 8.7);
		const hairSeed = vnoise(x * 2.2, y * .14, 421);
		const hair = hairSeed > .73 ? (hairSeed - .73) * 1.5 : 0;
		h[y * N + x] = pores * .32 + mottle * .22 + hair * .26 - cre * .13;
		mot[y * N + x] = mottle;
		crs[y * N + x] = cre;
	}
	const albedo = /* @__PURE__ */ new Uint8Array(147456);
	const normal = /* @__PURE__ */ new Uint8Array(147456);
	const arm = /* @__PURE__ */ new Uint8Array(147456);
	for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
		const i = y * N + x;
		const o = i * 4;
		const l = h[y * N + (x + N - 1) % N];
		const r = h[y * N + (x + 1) % N];
		const d = h[(y + N - 1) % N * N + x];
		const u = h[(y + 1) % N * N + x];
		let nx = (l - r) * 4.4;
		let ny = (d - u) * 4.4;
		let nz = 1;
		const il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
		nx *= il;
		ny *= il;
		nz *= il;
		const m2 = mot[i] - .5;
		const g = clamp(.895 + (h[i] - .28) * .15 - crs[i] * .075, 0, 1);
		albedo[o] = Math.round(clamp(g * (1 + m2 * .14) + crs[i] * .012, 0, 1) * 255);
		albedo[o + 1] = Math.round(clamp(g * (1 - m2 * .07) - .014, 0, 1) * 255);
		albedo[o + 2] = Math.round(clamp(g * (1 - m2 * .1), 0, 1) * 255);
		albedo[o + 3] = 255;
		normal[o] = Math.round((nx * .5 + .5) * 255);
		normal[o + 1] = Math.round((ny * .5 + .5) * 255);
		normal[o + 2] = Math.round((nz * .5 + .5) * 255);
		normal[o + 3] = 255;
		arm[o] = Math.round(clamp(.72 + h[i] * .28, 0, 1) * 255);
		arm[o + 1] = Math.round(clamp(.5 + (1 - h[i]) * .26, 0, 1) * 255);
		arm[o + 2] = 0;
		arm[o + 3] = Math.round(h[i] * 255);
	}
	const mk = (data, cs) => {
		const t = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
		t.colorSpace = cs;
		t.wrapS = RepeatWrapping;
		t.wrapT = RepeatWrapping;
		t.magFilter = LinearFilter;
		t.minFilter = LinearMipmapLinearFilter;
		t.generateMipmaps = true;
		t.anisotropy = 4;
		t.needsUpdate = true;
		return t;
	};
	const a = mk(albedo, SRGBColorSpace);
	const n = mk(normal, "");
	const m = mk(arm, "");
	m.channel = 0;
	return {
		albedo: a,
		normal: n,
		arm: m,
		dispose() {
			a.dispose();
			n.dispose();
			m.dispose();
		}
	};
}
/**
* SKIN, as a material and not as a grey plastic.
*
* The review scored this 2/10 and named three separate things, all of which are
* the same missing physics: "There is no subsurface — the silhouette edge stays
* the same dead grey as the core, where backlit fingers and web spaces should
* glow warm red"; "one tiling granular noise at identical density from elbow to
* fingertip"; "a uniform dull specular". A `MeshStandardMaterial` with a tiling
* normal map is a dielectric shell, and a dielectric shell is what plastic is.
*
* Three additions, patched on top of the shared viewmodel patch rather than
* replacing it, so the depth band and the aerial term are untouched:
*
* 1. SUBSURFACE. Flesh is a dense scattering medium: what leaves it is the
*    light that went IN somewhere else and came back out, and the thinner the
*    part the more of it there is and the redder it gets, because red scatters
*    furthest. Modelled here as a wrap term driven by the mask baked into
*    `askin.x` — fingertips, pads, the thumb web, the interdigital webs — and
*    weighted by grazing angle, so it is strongest exactly where a real hand
*    lights up: the rim of a finger seen against the sky. It is tinted toward
*    ember rather than pink, because these are Dunmer.
*
* 2. GRAIN DENSITY. The one tiling detail normal is sampled TWICE, at 1x and at
*    3.1x, and mixed by `askin.y`: fine pores on the flexor forearm and the
*    pads, coarse cross-hatch on the knuckles and the dorsum. Two samples of a
*    128-square texture is not a cost worth measuring, and it is the whole
*    difference between skin with regions and a knitted sock.
*
* 3. SHEEN. Skin has a broad, weak forward-scatter lobe on top of its specular
*    — the reason a hand held up to a window has a pale halo — which no single
*    roughness value reproduces. A fresnel-weighted add, small, and rougher
*    where the grain is coarse.
*/
function patchSkinMaterial(m) {
	const base = m.onBeforeCompile;
	m.onBeforeCompile = (shader, renderer) => {
		base(shader, renderer);
		shader.uniforms.uSss = { value: new Color(.85, .24, .12) };
		shader.vertexShader = shader.vertexShader.replace("void main() {", "attribute vec2 askin;\nvarying vec2 vSkin;\nvoid main() {").replace("#include <begin_vertex>", "#include <begin_vertex>\n  vSkin = askin;");
		shader.fragmentShader = shader.fragmentShader.replace("void main() {", "uniform vec3 uSss;\nvarying vec2 vSkin;\nvoid main() {").replace("#include <normal_fragment_maps>", `#ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 coarseN = texture2D( normalMap, vNormalMapUv * 3.1 + vec2(0.37, 0.11) ).xyz * 2.0 - 1.0;
          coarseN.xy *= normalScale * (0.55 + 0.95 * vSkin.y);
        #endif
        #include <normal_fragment_maps>
        #ifdef USE_NORMALMAP_TANGENTSPACE
          normal = normalize( normal + tbn * normalize(coarseN) * (0.30 + 0.55 * vSkin.y) );
        #endif`).replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = clamp( roughnessFactor * (0.90 + 0.16 * vSkin.y) - 0.05 * vSkin.x, 0.05, 1.0 );`).replace("#include <opaque_fragment>", `{
          vec3 V = normalize( vViewPosition );
          float graze = 1.0 - clamp( dot( V, normal ), 0.0, 1.0 );
          // Thin flesh lit from anywhere lets light through; thin flesh seen
          // edge-on lets a lot through. Driven off the luminance already in
          // outgoingLight so it tracks sun, shadow and time of day for free —
          // a constant add would make the fingertips glow in a cellar.
          float lum = dot( outgoingLight, vec3(0.2126, 0.7152, 0.0722) );
          float thin = vSkin.x * (0.25 + 1.00 * graze * graze);
          outgoingLight += uSss * lum * thin * 0.45;
          // ...and the broad forward-scatter halo, on every part of the skin.
          outgoingLight += vec3(0.55, 0.48, 0.46) * lum * pow( graze, 3.5 ) * 0.22;
        }
        #include <opaque_fragment>`);
	};
	m.needsUpdate = true;
}
/**
* Arm segment lengths, and they are NOT anatomical.
*
* The arm root is not a shoulder (see `armRoot`), so the "upper arm" is only
* the length of tube needed to fill the corner of the frame between the elbow
* and the edge. Authoring it at a real 0.30 m put the elbow a third of the way
* across the screen and the forearm read as a log.
*/
const UPPER = .24;
const FORE = .245;
const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _axis = new Vector3();
const _ortho = new Vector3();
const _pole = new Vector3();
const _q0 = new Quaternion();
const _q1 = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _elbow = new Vector3();
const _wrist = new Vector3();
const _shoulder = new Vector3();
const _m = new Matrix4();
const _fwd = new Vector3();
var Viewmodel = class {
	group = new Group();
	geos = [];
	materials = [];
	skinTex = skinTextures();
	mats;
	skinMat;
	nailMat;
	sleeveMat;
	bracerMat;
	shieldMat;
	rUpper;
	rFore;
	lUpper;
	lFore;
	rHand;
	lHand;
	rFist;
	lFist;
	lStrap;
	shield;
	/**
	* Hand geometry, keyed by grip section. A hand is built around the haft it
	* holds, so changing weapon class rebuilds it — but a player cycling two
	* weapons must not re-solve twenty bone chains every time, hence the cache.
	*/
	gripCache = /* @__PURE__ */ new Map();
	gripKey = "";
	look = { ...DEFAULT_LOOK };
	bobPhase = 0;
	breathe = 0;
	sway = new Vector3();
	swayVel = new Vector3();
	lastYaw = 0;
	lastPitch = 0;
	landDip = 0;
	landVel = 0;
	wasGrounded = true;
	/** Aim-space offset the caller adds to the hand anchor. Small by design. */
	offset = new Vector3();
	/** Last frame's dt, so `update` can differentiate the hand anchor. */
	frameDt = 1 / 60;
	rHandLast = new Vector3();
	lHandLast = new Vector3();
	rHandVel = new Vector3();
	lHandVel = new Vector3();
	upperArm = {
		pos: new Vector3(),
		quat: new Quaternion(),
		len: UPPER
	};
	foreArm = {
		pos: new Vector3(),
		quat: new Quaternion(),
		len: FORE
	};
	constructor(mats) {
		this.mats = mats;
		this.group.name = "viewmodel";
		this.group.frustumCulled = false;
		this.build();
	}
	mat(setName, color, rough, metal) {
		const m = makeMaterial(this.mats, setName, color, rough, metal, true);
		this.materials.push(m);
		return m;
	}
	build() {
		this.skinMat = new MeshStandardMaterial({
			color: DEFAULT_LOOK.skin,
			map: this.skinTex.albedo,
			normalMap: this.skinTex.normal,
			roughnessMap: this.skinTex.arm,
			aoMap: this.skinTex.arm,
			roughness: .92,
			metalness: 0,
			vertexColors: true
		});
		this.skinMat.envMapIntensity = .45;
		this.skinMat.normalScale.set(.85, .85);
		this.skinMat;
		patchSkinMaterial(this.skinMat);
		this.materials.push(this.skinMat);
		this.nailMat = new MeshStandardMaterial({
			color: 9077906,
			normalMap: this.skinTex.normal,
			roughness: .52,
			metalness: 0,
			vertexColors: true
		});
		this.nailMat.envMapIntensity = .45;
		this.nailMat.normalScale.set(.25, .25);
		this.nailMat;
		this.materials.push(this.nailMat);
		this.sleeveMat = this.mat("cloth", 4864556, .92, 0);
		this.bracerMat = this.mat("iron", 7236198, .44, 1);
		this.shieldMat = this.mat("wood_weathered", 5324847, .8, 0);
		const seg = (rest, geo, material) => {
			this.geos.push(geo);
			const mesh = new Mesh(geo, material);
			mesh.castShadow = false;
			mesh.receiveShadow = true;
			mesh.frustumCulled = false;
			this.group.add(mesh);
			return {
				mesh,
				pos: new Vector3(),
				quat: new Quaternion(),
				len: rest,
				rest
			};
		};
		const rightFore = forearmGeometry(FORE);
		const upper = upperArmGeometry(UPPER);
		this.rUpper = seg(UPPER, upper, this.sleeveMat);
		this.rFore = seg(FORE, rightFore, this.skinMat);
		this.rFore.mesh.name = "vm-fore-r";
		this.lUpper = seg(UPPER, mirrorZ(upper), this.sleeveMat);
		this.lFore = seg(FORE, mirrorZ(rightFore), this.skinMat);
		const blade = this.handPair("168x134", {
			x: .0168,
			z: .0134
		}, false, GRIP_LIFT);
		this.rHand = this.mount(blade.r, "vm-hand-r");
		this.lHand = this.mount(blade.l, "vm-hand-l");
		const fist = this.handPair("#fist", FIST_GRIP, true);
		this.rFist = this.mount(fist.r, "vm-fist-r");
		this.lFist = this.mount(fist.l, "vm-fist-l");
		this.lStrap = this.mount(this.handPair("#strap", SHIELD_GRIP, false).l, "vm-hand-strap");
		this.gripKey = "168x134";
		const sg = shieldGeometry(.21);
		this.geos.push(sg);
		this.shield = new Mesh(sg, this.shieldMat);
		this.shield.castShadow = false;
		this.shield.receiveShadow = true;
		this.shield.frustumCulled = false;
		this.group.add(this.shield);
	}
	/**
	* The right hand solved on a grip section, and its mirror. The left hand is
	* literally the right one reflected through the blade's flat, which is
	* exactly what two hands on one haft are, and the mirror carries the ulnar
	* direction with it so the forearm behind a left hand rolls its ridge to the
	* LEFT hand's little finger.
	*/
	handPair(key, section, fist, lift = 0) {
		let r = this.gripCache.get(key);
		if (r === void 0) {
			r = handGeometry(section, fist, lift);
			this.gripCache.set(key, r);
		}
		let l = this.gripCache.get(`${key}:L`);
		if (l === void 0) {
			l = {
				geo: mirrorZ(r.geo),
				wrist: new Vector3(r.wrist.x, r.wrist.y, -r.wrist.z),
				axis: new Vector3(r.axis.x, r.axis.y, -r.axis.z),
				ulnar: new Vector3(r.ulnar.x, r.ulnar.y, -r.ulnar.z),
				triangles: r.triangles
			};
			this.gripCache.set(`${key}:L`, l);
		}
		return {
			r,
			l
		};
	}
	mount(h, name) {
		const mesh = new Mesh(h.geo, [this.skinMat, this.nailMat]);
		mesh.name = name;
		mesh.castShadow = false;
		mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		this.group.add(mesh);
		return {
			mesh,
			wrist: h.wrist.clone(),
			axis: h.axis.clone(),
			ulnar: h.ulnar.clone()
		};
	}
	/**
	* Re-solve the gripping hands around the haft of the weapon now held. The
	* grip section comes from `Gear.gripSection`, which the haft prisms are also
	* built from, so the fingers close on the surface that is actually drawn
	* rather than on an assumed radius — a warhammer haft is 43 mm across and a
	* sword's hilt 34 by 27, and a hand that ignores the difference either floats
	* off one or is buried in the other.
	*/
	ensureGrip(def) {
		const section = gripSection(def);
		const key = `${Math.round(section.x * 1e4)}x${Math.round(section.z * 1e4)}`;
		if (key === this.gripKey) return;
		this.gripKey = key;
		const pair = this.handPair(key, section, false, GRIP_LIFT);
		this.rHand.mesh.geometry = pair.r.geo;
		this.lHand.mesh.geometry = pair.l.geo;
		this.rHand.wrist.copy(pair.r.wrist);
		this.rHand.axis.copy(pair.r.axis);
		this.rHand.ulnar.copy(pair.r.ulnar);
		this.lHand.wrist.copy(pair.l.wrist);
		this.lHand.axis.copy(pair.l.axis);
		this.lHand.ulnar.copy(pair.l.ulnar);
	}
	/**
	* Re-dress a material for an armour material key: tint, finish AND the
	* synthesized texture set, so a chitin bracer is chitin rather than iron
	* painted amber. Swapping map references on a live material is a re-upload of
	* three texture pointers, not a recompile.
	*/
	dress(m, key, fallback) {
		const look = ARMOUR_LOOK[key] ?? ARMOUR_LOOK[fallback];
		m.color.setHex(look.color);
		m.roughness = Math.min(1, look.rough * 1.6);
		m.metalness = Math.min(1, look.metal * 1.25);
		const setName = ARMOUR_SET[key] ?? ARMOUR_SET[fallback];
		if (this.mats === null) return;
		try {
			const set = this.mats.get(setName);
			m.map = set.albedo;
			m.normalMap = set.normal;
			m.roughnessMap = set.arm;
			m.metalnessMap = set.arm;
			m.aoMap = set.arm;
			m.needsUpdate = true;
		} catch {}
	}
	/** Re-read race and equipped gear. Cheap enough to call on every equip. */
	refresh(rpg) {
		this.look = readArmLook(rpg);
		this.skinMat.color.setHex(this.look.skin);
		const c = new Color(this.look.skin);
		this.nailMat.color.setRGB(Math.min(1, c.r * 1.06 + .02), Math.min(1, c.g * 1.02 + .016), Math.min(1, c.b * 1.08 + .024));
		const sleeve = this.look.sleeve;
		if (sleeve !== null) this.dress(this.sleeveMat, sleeve, "cloth");
		this.rUpper.mesh.material = sleeve === null ? this.skinMat : this.sleeveMat;
		this.lUpper.mesh.material = sleeve === null ? this.skinMat : this.sleeveMat;
		const bracer = this.look.rightGauntlet ?? this.look.leftGauntlet;
		if (bracer !== null) this.dress(this.bracerMat, bracer, "iron");
		this.rFore.mesh.material = this.look.rightGauntlet === null ? this.skinMat : this.bracerMat;
		this.lFore.mesh.material = this.look.leftGauntlet === null ? this.skinMat : this.bracerMat;
	}
	/** The material set a shield of this definition should be dressed in. */
	setShield(def) {
		this.dress(this.shieldMat, def.material, "leather");
	}
	/**
	* Idle motion, integrated once per frame and published on `offset` in aim
	* space. The caller adds it to the hand anchor BEFORE the swing is posed, so
	* the swept hit test moves with the hand rather than against it — a sway that
	* only moved the drawing would be exactly the drift this whole file exists to
	* avoid.
	*
	* Everything here is deliberately smaller than it wants to be. The camera rig
	* already bobs the eye by 2-4 cm and the arms inherit that for free by being
	* positioned off the camera; what is added here is only the RELATIVE lag of a
	* hand against a torso, which is a centimetre, not four.
	*/
	step(dt, yaw, pitch, speed, grounded, fallSpeed) {
		this.breathe += dt;
		const moving = grounded ? clamp(speed / 4.2, 0, 1.25) : 0;
		this.bobPhase += dt * (2.4 + speed * .75);
		if (this.bobPhase > Math.PI * 2) this.bobPhase -= Math.PI * 2;
		const bobX = Math.sin(this.bobPhase) * .011 * moving;
		const bobY = Math.sin(this.bobPhase * 2) * .008 * moving;
		const br = 1 - moving * .6;
		const breatheY = Math.sin(this.breathe * 1.15) * .0055 * br;
		const breatheX = Math.sin(this.breathe * .57) * .004 * br;
		let dYaw = yaw - this.lastYaw;
		while (dYaw > Math.PI) dYaw -= Math.PI * 2;
		while (dYaw < -Math.PI) dYaw += Math.PI * 2;
		const dPitch = pitch - this.lastPitch;
		this.lastYaw = yaw;
		this.lastPitch = pitch;
		const kick = 1 / Math.max(dt, .001);
		this.swayVel.x += clamp(dYaw * .9, -.06, .06) * kick * dt;
		this.swayVel.y += clamp(dPitch * .55, -.05, .05) * kick * dt;
		this.swayVel.x -= (this.sway.x * 90 + this.swayVel.x * 17) * dt;
		this.swayVel.y -= (this.sway.y * 90 + this.swayVel.y * 17) * dt;
		this.sway.x = clamp(this.sway.x + this.swayVel.x * dt, -.028, .028);
		this.sway.y = clamp(this.sway.y + this.swayVel.y * dt, -.026, .026);
		if (grounded && !this.wasGrounded) this.landVel = Math.min(this.landVel, -clamp(Math.abs(fallSpeed) * .009, .008, .075));
		this.wasGrounded = grounded;
		this.landVel -= (this.landDip * 90 + this.landVel * 13) * dt;
		this.landDip = clamp(this.landDip + this.landVel * dt, -.05, .02);
		this.offset.set(bobX + breatheX + this.sway.x, bobY + breatheY + this.sway.y + this.landDip, 0);
		this.frameDt = dt;
	}
	/** Pose everything. Called after the weapon has been posed for the frame. */
	update(f) {
		const twoHanded = f.weapon.twoHanded;
		const unarmed = f.weapon.cls === "handtohand";
		const bow = f.weapon.cls === "marksman";
		const hasShield = !twoHanded && !bow && f.shield.id !== "none" && f.shield.id !== "parry";
		if (!unarmed) this.ensureGrip(f.weapon);
		const rHand = unarmed ? this.rFist : this.rHand;
		this.rHand.mesh.visible = !unarmed;
		this.rFist.mesh.visible = unarmed;
		rHand.mesh.position.copy(f.handPos);
		rHand.mesh.quaternion.copy(f.handQuat);
		const lHand = unarmed || !twoHanded && !hasShield && !bow ? this.lFist : hasShield ? this.lStrap : this.lHand;
		this.lHand.mesh.visible = lHand === this.lHand;
		this.lFist.mesh.visible = lHand === this.lFist;
		this.lStrap.mesh.visible = lHand === this.lStrap;
		this.shield.visible = hasShield;
		if (twoHanded) {
			_v0.set(0, .17, 0).applyQuaternion(f.handQuat).add(f.handPos);
			lHand.mesh.position.copy(_v0);
			lHand.mesh.quaternion.copy(f.handQuat);
		} else if (bow) {
			lHand.mesh.position.copy(f.handPos);
			lHand.mesh.quaternion.copy(f.handQuat);
			rHand.mesh.position.copy(f.handPos).addScaledVector(f.forward, -(.2 + .16 * f.draw)).addScaledVector(f.right, .13).addScaledVector(f.up, -.03);
			rHand.mesh.quaternion.copy(f.handQuat);
		} else if (hasShield) this.poseShield(f, lHand);
		else {
			const guard = f.guard;
			const tuck = f.swinging ? .04 : 0;
			const off = Math.sin(this.breathe * .93 + 1.9) * (1 - guard * .7);
			_v0.copy(f.origin).addScaledVector(f.right, -.3 + guard * .08 + tuck + off * .006).addScaledVector(f.up, -.325 + guard * .18 + off * .009).addScaledVector(f.forward, .55 - guard * .13 - off * .005);
			lHand.mesh.position.copy(_v0);
			_fwd.copy(f.up).multiplyScalar(.55).addScaledVector(f.forward, .5).addScaledVector(f.right, -.35 + guard * .2).normalize();
			_q0.setFromUnitVectors(_up, _fwd);
			_q0.multiply(_q1.setFromAxisAngle(_up, -.34 + off * .09 + guard * .22));
			lHand.mesh.quaternion.copy(_q0);
		}
		const live = f.swinging ? 1 : 0;
		const rDev = (unarmed ? .1 : bow ? .14 : .22) - live * .16;
		const rFlex = (bow ? .07 : unarmed ? -.05 : -.1) + f.guard * .06;
		const lDev = hasShield ? .15 : bow ? -.06 : twoHanded ? .17 : .09;
		const lFlex = bow ? .13 : hasShield ? .1 : -.04;
		this.solveFor(f, 1, rHand, rDev, rFlex);
		this.solveFor(f, -1, lHand, lDev, lFlex);
	}
	/**
	* Run the arm behind one posed hand.
	*
	* The forearm does NOT get to point wherever a two-bone solve would like it
	* to. It runs down the axis the hand's own wrist leaves along, because that
	* is the only way its distal ring and the hand's wrist stub are the same
	* ellipse in the same plane in the same orientation — and two tubes that meet
	* at even five degrees show a rim, which is what read as a bracelet in every
	* close-up of the last three versions. So the wrist is a WELD, the elbow is
	* placed a forearm's length back up that axis, and the upper arm — which is
	* sleeved and mostly off the bottom of the frame — absorbs whatever is left
	* over by stretching. The IK is still there; it has just been demoted to the
	* bone nobody can see.
	*
	* The elbow is then nudged toward where a two-bone solve would have put it,
	* but only by rotating the whole forearm, so the weld survives it.
	*/
	solveFor(f, side, hand, dev, flex) {
		_wrist.copy(hand.wrist).applyQuaternion(hand.mesh.quaternion).add(hand.mesh.position);
		this.armRoot(f, side, hand.mesh.position, _shoulder);
		_v0.copy(hand.axis).applyQuaternion(hand.mesh.quaternion).normalize();
		/**
		* WRIST DEVIATION AND FLEXION, per pose.
		*
		* "The wrist is locked dead straight in every single frame — rest, block,
		* wind, swing, bow and hammer all show zero ulnar/radial deviation and
		* near-zero flexion. The uniformity reads as a mannequin." It did, and the
		* cause was structural: the hand is welded to the weapon anchor and the
		* forearm was aimed down the hand's OWN authored axis, so the wrist angle
		* was a constant of the mesh rather than a parameter of the pose.
		*
		* It is still a weld — the hand does not move, the hit test is untouched —
		* because the joint is bent from the FOREARM end. Rotating the proximal
		* direction about the hand's dorsal axis is ulnar/radial deviation; about
		* its ulnar axis is flexion/extension. A sword hand carries 10-15 degrees
		* of ulnar deviation at rest, which is not a stylistic choice: it is what
		* putting a hilt in line with the forearm's long axis requires, and its
		* absence is the single loudest "this is a rig at bind pose" tell there is.
		*
		* A little live noise on top, on the breathing clock, so no two frames are
		* ever quite the same angle.
		*/
		_v1.copy(hand.ulnar).applyQuaternion(hand.mesh.quaternion).normalize();
		_pole.crossVectors(_v0, _v1).multiplyScalar(side).normalize();
		const wob = Math.sin(this.breathe * 1.37 + (side > 0 ? 0 : 2.1)) * .018 + Math.sin(this.breathe * .71 + (side > 0 ? 1.3 : 3.4)) * .012;
		if (_pole.lengthSq() > .5) _v0.applyAxisAngle(_pole, dev + wob).normalize();
		_v0.applyAxisAngle(_v1, flex + wob * .6).normalize();
		/**
		* WRIST LEAD AND LAG, and it is the one thing that stops the whole arm
		* swinging as a single welded piece.
		*
		* The hand is nailed to the weapon anchor and must stay there — the hit
		* test is that same pose — so the wrist angle cannot be animated by turning
		* the HAND. It can be animated by turning the FOREARM, which is the same
		* joint read from the other end and costs the weld nothing.
		*
		* The drive is the hand's own velocity, smoothed, so no new signal has to
		* be plumbed through from the swing state machine and the lag is
		* automatically right for a thrust, a chop and a shield raise alike: the
		* elbow is displaced OPPOSITE the direction of travel, so on the windup the
		* hand runs ahead of the forearm and through the strike it whips back
		* through it. At a 9 m/s tip speed that is about twelve degrees, which is
		* roughly what a real wrist gives up under load, and it is capped there —
		* past about fifteen it stops reading as whip and starts reading as broken.
		*/
		const vel = side > 0 ? this.rHandVel : this.lHandVel;
		const last = side > 0 ? this.rHandLast : this.lHandLast;
		if (this.frameDt > 1e-4) {
			_v2.subVectors(hand.mesh.position, last).multiplyScalar(1 / this.frameDt);
			if (_v2.lengthSq() > 400) _v2.set(0, 0, 0);
			vel.lerp(_v2, clamp(this.frameDt * 26, 0, 1));
		}
		last.copy(hand.mesh.position);
		const speed = vel.length();
		if (speed > .35) {
			_v2.copy(vel).multiplyScalar(1 / speed);
			_v2.addScaledVector(_v0, -_v2.dot(_v0));
			if (_v2.lengthSq() > 1e-8) _v0.addScaledVector(_v2.normalize(), -Math.min(.27, (speed - .35) * .03)).normalize();
		}
		_v1.subVectors(_shoulder, _wrist).normalize();
		const toward = clamp((_v0.dot(f.forward) - .06) * 2.4, 0, .5);
		if (toward > 0) _v0.lerp(_v1, toward).normalize();
		_elbow.copy(_wrist).addScaledVector(_v0, FORE);
		this.foreArm.pos.copy(_elbow);
		this.foreArm.len = FORE;
		this.foreArm.quat.setFromUnitVectors(_up, _v2.copy(_v0).negate());
		this.rollForearm(hand);
		_v1.subVectors(_elbow, _shoulder);
		this.upperArm.pos.copy(_shoulder);
		this.upperArm.len = Math.max(.001, _v1.length());
		this.upperArm.quat.setFromUnitVectors(_up, _v1.divideScalar(this.upperArm.len));
		this.applySegment(side > 0 ? this.rUpper : this.lUpper, this.upperArm);
		this.applySegment(side > 0 ? this.rFore : this.lFore, this.foreArm);
	}
	/**
	* Roll the forearm about its own bone axis so its ulna ridge lands on the
	* little-finger side of the hand it ends in.
	*
	* Without this the roll is whatever `setFromUnitVectors` happens to produce,
	* which is a well-defined number and an anatomically meaningless one — the
	* ridge and the flexor mass would wander round the arm as the hand moved.
	* With it, pronating the hand pronates the forearm, which is the one motion
	* that tells a viewer these two parts belong to the same body.
	*/
	rollForearm(hand) {
		_axis.set(0, 1, 0).applyQuaternion(this.foreArm.quat);
		_v0.copy(hand.ulnar).applyQuaternion(hand.mesh.quaternion);
		_v0.addScaledVector(_axis, -_v0.dot(_axis));
		if (_v0.lengthSq() < 1e-6) return;
		_v0.normalize();
		_v1.copy(FOREARM_ULNAR).applyQuaternion(this.foreArm.quat);
		_v1.addScaledVector(_axis, -_v1.dot(_axis));
		if (_v1.lengthSq() < 1e-6) return;
		_v1.normalize();
		const c = clamp(_v1.dot(_v0), -1, 1);
		const s = _axis.dot(_v2.crossVectors(_v1, _v0));
		this.foreArm.quat.premultiply(_q1.setFromAxisAngle(_axis, Math.atan2(s, c)));
	}
	/**
	* Where the arm leaves the frame. Not an anatomical shoulder: it sits below
	* the bottom edge of the screen and AHEAD of the eye, because a shoulder
	* placed anatomically (behind the lens) is 80 cm from a hand that a 56 cm arm
	* has to reach, and the fix for that is to stop pretending the camera is a
	* head. Nothing here is ever on screen; only the direction the arm enters
	* from is.
	*/
	armRoot(f, side, hand, out) {
		_v1.subVectors(hand, f.origin);
		const lead = clamp(_v1.dot(f.forward) - .72, -.16, .9) * .55;
		out.copy(f.origin).addScaledVector(f.right, .34 * side).addScaledVector(f.up, -.46).addScaledVector(f.forward, .4 + lead);
	}
	applySegment(s, src) {
		s.mesh.position.copy(src.pos);
		s.mesh.quaternion.copy(src.quat);
		s.mesh.scale.set(1, src.len / s.rest, 1);
	}
	/**
	* The shield: a relaxed carry at the hip, and a real guard in front of the
	* face when blocking. `Guard.amount` is already smoothed and rises faster
	* than it falls, so this is a straight lerp between two poses and the weight
	* comes from the mechanic rather than from a second filter.
	*/
	poseShield(f, hand) {
		const g = f.guard;
		_v0.copy(f.origin).addScaledVector(f.right, -.4 + g * .06).addScaledVector(f.up, -.36 + g * .3).addScaledVector(f.forward, .45 + g * .06);
		_fwd.copy(f.forward).multiplyScalar(.35 + g * .6).addScaledVector(f.right, -.55 + g * .25).addScaledVector(f.up, -.5 + g * .42).normalize();
		_v1.copy(f.up).addScaledVector(_fwd, -f.up.dot(_fwd));
		if (_v1.lengthSq() < 1e-6) _v1.copy(f.right);
		_v1.normalize();
		_axis.crossVectors(_v1, _fwd).normalize();
		_m.makeBasis(_axis, _v1, _fwd);
		_q0.setFromRotationMatrix(_m);
		this.shield.position.copy(_v0);
		this.shield.quaternion.copy(_q0);
		hand.mesh.position.copy(_v0).addScaledVector(_axis, .052).addScaledVector(_v1, -.07).addScaledVector(_fwd, .018);
		_v2.copy(_axis).multiplyScalar(-1);
		_ortho.copy(_fwd).multiplyScalar(-1);
		_pole.crossVectors(_ortho, _v2);
		_m.makeBasis(_ortho, _v2, _pole);
		_q0.setFromRotationMatrix(_m);
		hand.mesh.quaternion.copy(_q0);
	}
	set visible(v) {
		this.group.visible = v;
	}
	get visible() {
		return this.group.visible;
	}
	/** Triangle count, for the budget report. */
	get triangles() {
		let n = 0;
		for (const g of this.geos) {
			const i = g.getIndex();
			n += i === null ? 0 : i.count / 3;
		}
		for (const h of this.gripCache.values()) {
			const i = h.geo.getIndex();
			n += i === null ? 0 : i.count / 3;
		}
		return n;
	}
	/** Triangles actually submitted this frame, which is the number that costs. */
	get drawnTriangles() {
		let n = 0;
		this.group.traverseVisible((o) => {
			if (!(o instanceof Mesh)) return;
			const i = o.geometry.getIndex();
			n += i === null ? 0 : i.count / 3;
		});
		return n;
	}
	dispose() {
		for (const g of this.geos) g.dispose();
		this.geos.length = 0;
		for (const h of this.gripCache.values()) h.geo.dispose();
		this.gripCache.clear();
		for (const m of this.materials) m.dispose();
		this.materials.length = 0;
		this.skinTex.dispose();
		this.group.removeFromParent();
		this.group.clear();
	}
};
//#endregion
export { FORE, FOREARM_GIRTH, FOREARM_GIRTH_PEAK, FOREARM_RATIO, GRIP_LIFT, UPPER, Viewmodel, WRIST_RU, WRIST_RV, chainPoint, forearmGeometry, forearmRelief, forearmSection, handGeometry, mirrorZ, readArmLook, upperArmGeometry };
