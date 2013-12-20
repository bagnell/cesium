/*global define*/
define([
        '../Core/defaultValue',
        '../Core/DeveloperError',
        '../Core/defined',
        '../Core/destroyObject',
        '../Core/Cartesian2',
        '../Core/Cartesian3',
        '../Core/Matrix4',
        '../Core/writeTextToCanvas',
        '../Core/ObjectOrientedBoundingBox',
        '../Core/BoundingRectangle',
        './BillboardCollection',
        './Label',
        './LabelStyle',
        './HorizontalOrigin',
        './VerticalOrigin',
        '../Scene/SceneTransforms'
    ], function(
        defaultValue,
        DeveloperError,
        defined,
        destroyObject,
        Cartesian2,
        Cartesian3,
        Matrix4,
        writeTextToCanvas,
        ObjectOrientedBoundingBox,
        BoundingRectangle,
        BillboardCollection,
        Label,
        LabelStyle,
        HorizontalOrigin,
        VerticalOrigin,
        SceneTransforms) {
    "use strict";

    // A glyph represents a single character in a particular label.  It may or may
    // not have a billboard, depending on whether the texture info has an index into
    // the the label collection's texture atlas.  Invisible characters have no texture, and
    // no billboard.  However, it always has a valid dimensions object.
    function Glyph() {
        this.textureInfo = undefined;
        this.dimensions = undefined;
        this.billboard = undefined;
    }

    // GlyphTextureInfo represents a single character, drawn in a particular style,
    // shared and reference counted across all labels.  It may or may not have an
    // index into the label collection's texture atlas, depending on whether the character
    // has both width and height, but it always has a valid dimensions object.
    function GlyphTextureInfo(labelCollection, index, dimensions) {
        this.labelCollection = labelCollection;
        this.index = index;
        this.dimensions = dimensions;
    }

    // reusable object for calling writeTextToCanvas
    var writeTextToCanvasParameters = {};
    function createGlyphCanvas(character, font, fillColor, outlineColor, outlineWidth, style, verticalOrigin) {
        writeTextToCanvasParameters.font = font;
        writeTextToCanvasParameters.fillColor = fillColor;
        writeTextToCanvasParameters.strokeColor = outlineColor;
        writeTextToCanvasParameters.strokeWidth = outlineWidth;

        if (verticalOrigin === VerticalOrigin.BOTTOM) {
            writeTextToCanvasParameters.textBaseline = 'bottom';
        } else if (verticalOrigin === VerticalOrigin.TOP) {
            writeTextToCanvasParameters.textBaseline = 'top';
        } else {
            // VerticalOrigin.CENTER
            writeTextToCanvasParameters.textBaseline = 'middle';
        }

        writeTextToCanvasParameters.fill = style === LabelStyle.FILL || style === LabelStyle.FILL_AND_OUTLINE;
        writeTextToCanvasParameters.stroke = style === LabelStyle.OUTLINE || style === LabelStyle.FILL_AND_OUTLINE;

        return writeTextToCanvas(character, writeTextToCanvasParameters);
    }

    function unbindGlyph(labelCollection, glyph) {
        glyph.textureInfo = undefined;
        glyph.dimensions = undefined;

        var billboard = glyph.billboard;
        if (defined(billboard)) {
            billboard.setShow(false);
            billboard.setImageIndex(-1);
            // Destroy pickId to allow setting _pickIdThis and _id when the billboard is reused.
            billboard._pickId = billboard._pickId && billboard._pickId.destroy();
            labelCollection._spareBillboards.push(billboard);
            glyph.billboard = undefined;
        }
    }


    function rebindAllGlyphs(labelCollection, label) {
        var text = label._text;
        var textLength = text.length;
        var glyphs = label._glyphs;
        var glyphsLength = glyphs.length;

        var glyph, glyphIndex, textIndex;

        // if we have more glyphs than needed, unbind the extras.
        if (textLength < glyphsLength) {
            for (glyphIndex = textLength; glyphIndex < glyphsLength; ++glyphIndex) {
                unbindGlyph(labelCollection, glyphs[glyphIndex]);
            }
        }

        // presize glyphs to match the new text length
        glyphs.length = textLength;

        var glyphTextureCache = labelCollection._glyphTextureCache;
        var textureAtlas = labelCollection._textureAtlas;

        // walk the text looking for new characters (creating new glyphs for each)
        // or changed characters (rebinding existing glyphs)
        for (textIndex = 0; textIndex < textLength; ++textIndex) {
            var character = text.charAt(textIndex);
            var font = label._font;
            var fillColor = label._fillColor;
            var outlineColor = label._outlineColor;
            var outlineWidth = label._outlineWidth;
            var style = label._style;
            var verticalOrigin = label._verticalOrigin;

            // retrieve glyph dimensions and texture index (if the canvas has area)
            // from the glyph texture cache, or create and add if not present.
            var id = JSON.stringify([
                                     character,
                                     font,
                                     fillColor.toRgba(),
                                     outlineColor.toRgba(),
                                     outlineWidth,
                                     +style,
                                     +verticalOrigin
                                    ]);

            var glyphTextureInfo = glyphTextureCache[id];
            if (!defined(glyphTextureInfo)) {
                var canvas = createGlyphCanvas(character, font, fillColor, outlineColor, outlineWidth, style, verticalOrigin);
                var index = -1;
                if (canvas.width > 0 && canvas.height > 0) {
                    index = textureAtlas.addImage(canvas);
                }

                glyphTextureInfo = new GlyphTextureInfo(labelCollection, index, canvas.dimensions);
                glyphTextureCache[id] = glyphTextureInfo;
            }

            glyph = glyphs[textIndex];

            if (defined(glyph)) {
                // clean up leftover information from the previous glyph
                if (glyphTextureInfo.index === -1) {
                    // no texture, and therefore no billboard, for this glyph.
                    // so, completely unbind glyph.
                    unbindGlyph(labelCollection, glyph);
                } else {
                    // we have a texture and billboard.  If we had one before, release
                    // our reference to that texture info, but reuse the billboard.
                    if (defined(glyph.textureInfo)) {
                        glyph.textureInfo = undefined;
                    }
                }
            } else {
                // create a glyph object
                glyph = new Glyph();
                glyphs[textIndex] = glyph;
            }

            glyph.textureInfo = glyphTextureInfo;
            glyph.dimensions = glyphTextureInfo.dimensions;

            // if we have a texture, configure the existing billboard, or obtain one
            if (glyphTextureInfo.index !== -1) {
                var billboard = glyph.billboard;
                if (!defined(billboard)) {
                    if (labelCollection._spareBillboards.length > 0) {
                        glyph.billboard = billboard = labelCollection._spareBillboards.pop();
                    } else {
                        glyph.billboard = billboard = labelCollection._billboardCollection.add();
                    }

                    billboard.setShow(label._show);
                    billboard.setPosition(label._position);
                    billboard.setEyeOffset(label._eyeOffset);
                    billboard.setPixelOffset(label._pixelOffset);
                    billboard.setHorizontalOrigin(HorizontalOrigin.LEFT);
                    billboard.setVerticalOrigin(label._verticalOrigin);
                    billboard.setScale(label._scale);
                    billboard._pickIdThis = label;
                    billboard._id = label._id;
                }

                glyph.billboard.setImageIndex(glyphTextureInfo.index);
                glyph.billboard.setTranslucencyByDistance(label._translucencyByDistance);
                glyph.billboard.setPixelOffsetScaleByDistance(label._pixelOffsetScaleByDistance);
            }
        }

        // changing glyphs will cause the position of the
        // glyphs to change, since different characters have different widths
        label._repositionAllGlyphs = true;
    }

    // reusable Cartesian2 instance
    var glyphPixelOffset = new Cartesian2();
    function repositionAllGlyphs(label) {
        var glyphs = label._glyphs;
        var glyph;
        var dimensions;
        var totalWidth = 0;
        var maxHeight = 0;

        var glyphIndex = 0;
        var glyphLength = glyphs.length;
        for (glyphIndex = 0; glyphIndex < glyphLength; ++glyphIndex) {
            glyph = glyphs[glyphIndex];
            dimensions = glyph.dimensions;
            totalWidth += dimensions.width;
            maxHeight = Math.max(maxHeight, dimensions.height);
        }

        label._width = totalWidth;
        label._height = maxHeight;

        var scale = label._scale;
        var horizontalOrigin = label._horizontalOrigin;
        var widthOffset = 0;
        if (horizontalOrigin === HorizontalOrigin.CENTER) {
            widthOffset -= totalWidth / 2 * scale;
        } else if (horizontalOrigin === HorizontalOrigin.RIGHT) {
            widthOffset -= totalWidth * scale;
        }

        glyphPixelOffset.x = widthOffset;
        glyphPixelOffset.y = 0;

        var verticalOrigin = label._verticalOrigin;
        for (glyphIndex = 0; glyphIndex < glyphLength; ++glyphIndex) {
            glyph = glyphs[glyphIndex];
            dimensions = glyph.dimensions;

            if (verticalOrigin === VerticalOrigin.BOTTOM || dimensions.height === maxHeight) {
                glyphPixelOffset.y = -dimensions.descent * scale;
            } else if (verticalOrigin === VerticalOrigin.TOP) {
                glyphPixelOffset.y = -(maxHeight - dimensions.height) * scale - dimensions.descent * scale;
            } else if (verticalOrigin === VerticalOrigin.CENTER) {
                glyphPixelOffset.y = -(maxHeight - dimensions.height) / 2 * scale - dimensions.descent * scale;
            }

            if (defined(glyph.billboard)) {
                glyph.billboard._setTranslate(glyphPixelOffset);
            }

            glyphPixelOffset.x += dimensions.width * scale;
        }
    }

    function destroyLabel(labelCollection, label) {
        var glyphs = label._glyphs;
        for ( var i = 0, len = glyphs.length; i < len; ++i) {
            unbindGlyph(labelCollection, glyphs[i]);
        }
        label._labelCollection = undefined;
        destroyObject(label);
    }

    function sortLabelsByPriority(labels) {
        return labels.sort(function(a,b) {
            return b._priority-a._priority;
        });
    }

    function collides(label, indexInCollection) {
        var i=0;
        for (i=0;i<indexInCollection;++i) {
            if (ObjectOrientedBoundingBox.intersect(label._orientedBoundingBox, label._labelCollection._labels[i]._orientedBoundingBox)) {
               return true;
            }
        }
        return false;
    }
    var scratchPosition = new Cartesian3();
    var scratch2Dposition = new Cartesian2();
    function checkAndSetPosition(label, indexInCollection) { //first move the OOB then the Label

        var MAXTRYNUM=30;
        var shiftScale=3;

        var originalX = label._orientedBoundingBox.translation.x;
        var originalY = label._orientedBoundingBox.translation.y;
        var minusPos = originalY;
        var shift=0;
        var radius=12;
        scratch2Dposition.x = originalX;
        scratch2Dposition.y = originalY;
        var tempPos;
        if (collides(label, indexInCollection)) {//check on the up half side of the circle
            var i;
            for (i=0;i<MAXTRYNUM;++i) {
                tempPos = (-radius)+shift*radius/shiftScale;
                scratch2Dposition.x = tempPos+originalX; //TODO we should start from up to optimize, because usually width>height
                scratch2Dposition.y = Math.sqrt(Math.abs(radius*radius-tempPos*tempPos))+originalY; //up half side of the circle
                minusPos = -(Math.sqrt(Math.abs(radius*radius-tempPos*tempPos)))+originalY; //down half side of the circle

                label._orientedBoundingBox.translation.x = scratch2Dposition.x; //TODO Do we need scratch2Dposition?
                label._orientedBoundingBox.translation.y = scratch2Dposition.y;
                if (!collides(label, indexInCollection)) {//check on the up half side of the circle
                    break;
                }
                label._orientedBoundingBox.translation.y = minusPos;
                scratch2Dposition.y = minusPos;
                if (!collides(label, indexInCollection)) {//check on the down half side of the circle
                    break;
                }

                if (scratch2Dposition.x>=originalX+radius) {
                    radius+=12;
                    shift=0;
                } else {
                    ++shift;
                }

                if (i==MAXTRYNUM-1) { //Could not find a good place, let's put it on the original position. Some alpha modification would be good.
                    scratch2Dposition.x = originalX;
                    scratch2Dposition.y = originalY;
                }
            }

        }

        label._positionWS.x = scratch2Dposition.x-label._width/2;
        label._positionWS.y = scratch2Dposition.y-label._height/2;
    }

    /**
     * A renderable collection of labels.  Labels are viewport-aligned text positioned in the 3D scene.
     * Each label can have a different font, color, scale, etc.
     * <br /><br />
     * <div align='center'>
     * <img src='images/Label.png' width='400' height='300' /><br />
     * Example labels
     * </div>
     * <br /><br />
     * Labels are added and removed from the collection using {@link LabelCollection#add}
     * and {@link LabelCollection#remove}.
     *
     * @alias LabelCollection
     * @constructor
     *
     * @param {Matrix4} [options.modelMatrix=Matrix4.IDENTITY] The 4x4 transformation matrix that transforms each label from model to world coordinates.
     * @param {Boolean} [options.debugShowBoundingVolume=false] For debugging only. Determines if this primitive's commands' bounding spheres are shown.
     *
     * @performance For best performance, prefer a few collections, each with many labels, to
     * many collections with only a few labels each.  Avoid having collections where some
     * labels change every frame and others do not; instead, create one or more collections
     * for static labels, and one or more collections for dynamic labels.
     *
     * @see LabelCollection#add
     * @see LabelCollection#remove
     * @see Label
     * @see BillboardCollection
     *
     * @example
     * // Create a label collection with two labels
     * var labels = new LabelCollection();
     * labels.add({
     *   position : { x : 1.0, y : 2.0, z : 3.0 },
     *   text : 'A label'
     * });
     * labels.add({
     *   position : { x : 4.0, y : 5.0, z : 6.0 },
     *   text : 'Another label'
     * });
     *
     * @demo <a href="http://cesiumjs.org/Cesium/Apps/Sandcastle/index.html?src=Labels.html">Cesium Sandcastle Labels Demo</a>
     */
    var LabelCollection = function(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        this._textureAtlas = undefined;

        this._billboardCollection = new BillboardCollection();
        this._billboardCollection.setDestroyTextureAtlas(false);
        this._billboardCollection._screenPositionComputed = true;

        this._spareBillboards = [];
        this._glyphTextureCache = {};
        this._labels = [];
        this._labelsToUpdate = [];
        this._totalGlyphCount = 0;

        /**
         * The 4x4 transformation matrix that transforms each label in this collection from model to world coordinates.
         * When this is the identity matrix, the labels are drawn in world coordinates, i.e., Earth's WGS84 coordinates.
         * Local reference frames can be used by providing a different transformation matrix, like that returned
         * by {@link Transforms.eastNorthUpToFixedFrame}.  This matrix is available to GLSL vertex and fragment
         * shaders via {@link czm_model} and derived uniforms.
         *
         * @type Matrix4
         * @default {@link Matrix4.IDENTITY}
         *
         * @see Transforms.eastNorthUpToFixedFrame
         * @see czm_model
         *
         * @example
         * var center = ellipsoid.cartographicToCartesian(Cartographic.fromDegrees(-75.59777, 40.03883));
         * labels.modelMatrix = Transforms.eastNorthUpToFixedFrame(center);
         * labels.add({
         *   position : new Cartesian3(0.0, 0.0, 0.0),
         *   text     : 'Center'
         * });
         * labels.add({
         *   position : new Cartesian3(1000000.0, 0.0, 0.0),
         *   text     : 'East'
         * });
         * labels.add({
         *   position : new Cartesian3(0.0, 1000000.0, 0.0),
         *   text     : 'North'
         * });
         * labels.add({
         *   position : new Cartesian3(0.0, 0.0, 1000000.0),
         *   text     : 'Up'
         * });
         */
        this.modelMatrix = Matrix4.clone(defaultValue(options.modelMatrix, Matrix4.IDENTITY));

        /**
         * This property is for debugging only; it is not for production use nor is it optimized.
         * <p>
         * Draws the bounding sphere for each {@see DrawCommand} in the primitive.
         * </p>
         *
         * @type {Boolean}
         *
         * @default false
         */
        this.debugShowBoundingVolume = defaultValue(options.debugShowBoundingVolume, false);
    };

    /**
     * Creates and adds a label with the specified initial properties to the collection.
     * The added label is returned so it can be modified or removed from the collection later.
     *
     * @memberof LabelCollection
     *
     * @param {Object}[description] A template describing the label's properties as shown in Example 1.
     *
     * @returns {Label} The label that was added to the collection.
     *
     * @performance Calling <code>add</code> is expected constant time.  However, when
     * {@link LabelCollection#update} is called, the collection's vertex buffer
     * is rewritten; this operations is <code>O(n)</code> and also incurs
     * CPU to GPU overhead.  For best performance, add as many billboards as possible before
     * calling <code>update</code>.
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see LabelCollection#remove
     * @see LabelCollection#removeAll
     * @see LabelCollection#update
     *
     * @example
     * // Example 1:  Add a label, specifying all the default values.
     * var l = labels.add({
     *   show : true,
     *   position : Cartesian3.ZERO,
     *   text : '',
     *   font : '30px sans-serif',
     *   fillColor : 'white',
     *   outlineColor : 'white',
     *   style : LabelStyle.FILL,
     *   pixelOffset : Cartesian2.ZERO,
     *   eyeOffset : Cartesian3.ZERO,
     *   horizontalOrigin : HorizontalOrigin.LEFT,
     *   verticalOrigin : VerticalOrigin.BOTTOM,
     *   scale : 1.0
     * });
     *
     * // Example 2:  Specify only the label's cartographic position,
     * // text, and font.
     * var l = labels.add({
     *   position : ellipsoid.cartographicToCartesian(new Cartographic(longitude, latitude, height)),
     *   text : 'Hello World',
     *   font : '24px Helvetica',
     * });
     */
    LabelCollection.prototype.add = function(description) {
        var label = new Label(description, this);

        this._labels.push(label);
        this._labelsToUpdate.push(label);

        sortLabelsByPriority(this._labels);

        return label;
    };

    /**
     * Removes a label from the collection.  Once removed, a label is no longer usable.
     *
     * @memberof LabelCollection
     *
     * @param {Label} label The label to remove.
     *
     * @returns {Boolean} <code>true</code> if the label was removed; <code>false</code> if the label was not found in the collection.
     *
     * @performance Calling <code>remove</code> is expected constant time.  However, when
     * {@link LabelCollection#update} is called, the collection's vertex buffer
     * is rewritten - an <code>O(n)</code> operation that also incurs CPU to GPU overhead.  For
     * best performance, remove as many labels as possible before calling <code>update</code>.
     * If you intend to temporarily hide a label, it is usually more efficient to call
     * {@link Label#setShow} instead of removing and re-adding the label.
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see LabelCollection#add
     * @see LabelCollection#removeAll
     * @see LabelCollection#update
     * @see Label#setShow
     *
     * @example
     * var l = labels.add(...);
     * labels.remove(l);  // Returns true
     */
    LabelCollection.prototype.remove = function(label) {
        if (defined(label) && label._labelCollection === this) {
            var index = this._labels.indexOf(label);
            if (index !== -1) {
                this._labels.splice(index, 1);
                destroyLabel(this, label);
                return true;
            }
        }
        return false;
    };

    /**
     * Removes all labels from the collection.
     *
     * @memberof LabelCollection
     *
     * @performance <code>O(n)</code>.  It is more efficient to remove all the labels
     * from a collection and then add new ones than to create a new collection entirely.
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see LabelCollection#add
     * @see LabelCollection#remove
     * @see LabelCollection#update
     *
     * @example
     * labels.add(...);
     * labels.add(...);
     * labels.removeAll();
     */
    LabelCollection.prototype.removeAll = function() {
        var labels = this._labels;

        for ( var i = 0, len = labels.length; i < len; ++i) {
            destroyLabel(this, labels[i]);
        }

        labels.length = 0;
    };

    /**
     * Check whether this collection contains a given label.
     *
     * @memberof LabelCollection
     *
     * @param {Label} label The label to check for.
     *
     * @returns {Boolean} true if this collection contains the label, false otherwise.
     *
     * @see LabelCollection#get
     */
    LabelCollection.prototype.contains = function(label) {
        return defined(label) && label._labelCollection === this;
    };

    /**
     * Returns the label in the collection at the specified index.  Indices are zero-based
     * and increase as labels are added.  Removing a label shifts all labels after
     * it to the left, changing their indices.  This function is commonly used with
     * {@link LabelCollection#getLength} to iterate over all the labels
     * in the collection.
     *
     * @memberof LabelCollection
     *
     * @param {Number} index The zero-based index of the billboard.
     *
     * @returns {Label} The label at the specified index.
     *
     * @performance Expected constant time.  If labels were removed from the collection and
     * {@link LabelCollection#update} was not called, an implicit <code>O(n)</code>
     * operation is performed.
     *
     * @exception {DeveloperError} index is required.
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see LabelCollection#getLength
     *
     * @example
     * // Toggle the show property of every label in the collection
     * var len = labels.getLength();
     * for (var i = 0; i < len; ++i) {
     *   var l = billboards.get(i);
     *   l.setShow(!l.getShow());
     * }
     */
    LabelCollection.prototype.get = function(index) {
        if (!defined(index)) {
            throw new DeveloperError('index is required.');
        }

        return this._labels[index];
    };

    /**
     * Returns the number of labels in this collection.  This is commonly used with
     * {@link LabelCollection#get} to iterate over all the labels
     * in the collection.
     *
     * @memberof LabelCollection
     *
     * @returns {Number} The number of labels in this collection.
     *
     * @performance Expected constant time.  If labels were removed from the collection and
     * {@link LabelCollection#update} was not called, an implicit <code>O(n)</code>
     * operation is performed.
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see LabelCollection#get
     *
     * @example
     * // Toggle the show property of every label in the collection
     * var len = labels.getLength();
     * for (var i = 0; i < len; ++i) {
     *   var l = billboards.get(i);
     *   l.setShow(!l.getShow());
     * }
     */
    LabelCollection.prototype.getLength = function() {
        return this._labels.length;
    };

    //reusable instance
    var scratchBoundingRectangle = new BoundingRectangle();
    /**
     * @private
     */
    LabelCollection.prototype.update = function(context, frameState, commandList) {
        var billboardCollection = this._billboardCollection;

        billboardCollection.modelMatrix = this.modelMatrix;
        billboardCollection.debugShowBoundingVolume = this.debugShowBoundingVolume;

        if (!defined(this._textureAtlas)) {
            this._textureAtlas = context.createTextureAtlas();
            billboardCollection.setTextureAtlas(this._textureAtlas);
        }

        var i;
        var j;
        var label;

        var labelsToUpdate = this._labelsToUpdate;
        var length = labelsToUpdate.length;
        for (i = 0; i < length; ++i) {
            label = labelsToUpdate[i];
            if (label.isDestroyed()) {
                continue;
            }

            var preUpdateGlyphCount = label._glyphs.length;

            if (label._rebindAllGlyphs) {
                rebindAllGlyphs(this, label);
                label._rebindAllGlyphs = false;
            }

            if (label._repositionAllGlyphs) {
                repositionAllGlyphs(label);
                label._repositionAllGlyphs = false;
            }

            var glyphCountDifference = label._glyphs.length - preUpdateGlyphCount;
            this._totalGlyphCount += glyphCountDifference;
        }

        var labels = this._labels;
        length = labels.length;
        for (i = 0; i < length; ++i) {
            label = labels[i];

            label._positionWS = label.computeScreenSpacePosition(context, frameState);

            scratchBoundingRectangle.width = label._width;
            scratchBoundingRectangle.height = label._height;

            scratchBoundingRectangle.x = label._positionWS.x;
            scratchBoundingRectangle.y = label._positionWS.y;

            ObjectOrientedBoundingBox.fromBoundingRectangle(scratchBoundingRectangle, 0.0, label._orientedBoundingBox);

            checkAndSetPosition(label, i);

            var glyphs = label._glyphs;
            var glyphLength = glyphs.length;
            for (j = 0; j < glyphLength; j++) {
                var glyph = glyphs[j];
                if (defined(glyph.billboard)) {
                    glyph.billboard.setPosition(label._positionWS);
                }
            }
        }

        labelsToUpdate.length = 0;

        billboardCollection.update(context, frameState, commandList);
    };

    /**
     * Returns true if this object was destroyed; otherwise, false.
     * <br /><br />
     * If this object was destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
     *
     * @memberof LabelCollection
     *
     * @returns {Boolean} True if this object was destroyed; otherwise, false.
     *
     * @see LabelCollection#destroy
     */
    LabelCollection.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Destroys the WebGL resources held by this object.  Destroying an object allows for deterministic
     * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
     * <br /><br />
     * Once an object is destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
     * assign the return value (<code>undefined</code>) to the object as done in the example.
     *
     * @memberof LabelCollection
     *
     * @returns {undefined}
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see LabelCollection#isDestroyed
     *
     * @example
     * labels = labels && labels.destroy();
     */
    LabelCollection.prototype.destroy = function() {
        this.removeAll();
        this._billboardCollection = this._billboardCollection.destroy();
        this._textureAtlas = this._textureAtlas && this._textureAtlas.destroy();
        return destroyObject(this);
    };

    return LabelCollection;
});
