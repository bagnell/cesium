/*global require*/
require({
            baseUrl : '.',
            paths : {
                domReady : '../../ThirdParty/requirejs-2.1.20/domReady',
                Cesium : '../../Source'
            }
        }, [
            'Cesium/Core/BoundingRectangle',
            'Cesium/Core/Cartesian2',
            'Cesium/Core/Cartesian3',
            'Cesium/Core/Cartesian4',
            'Cesium/Core/Color',
            'Cesium/Core/ColorGeometryInstanceAttribute',
            'Cesium/Core/defined',
            'Cesium/Core/GeometryInstance',
            'Cesium/Core/Math',
            'Cesium/Core/Matrix4',
            'Cesium/Core/ScreenSpaceEventHandler',
            'Cesium/Core/ScreenSpaceEventType',
            'Cesium/Core/SimplePolylineGeometry',
            'Cesium/DataSources/KmlDataSource',
            'Cesium/Scene/Billboard',
            'Cesium/Scene/LabelCollection',
            'Cesium/Scene/PerInstanceColorAppearance',
            'Cesium/Scene/Primitive',
            'Cesium/Scene/SceneTransforms',
            'Cesium/ThirdParty/when',
            'Cesium/Widgets/Viewer/Viewer',
            'domReady!'
        ], function(
    BoundingRectangle,
    Cartesian2,
    Cartesian3,
    Cartesian4,
    Color,
    ColorGeometryInstanceAttribute,
    defined,
    GeometryInstance,
    CesiumMath,
    Matrix4,
    ScreenSpaceEventHandler,
    ScreenSpaceEventType,
    SimplePolylineGeometry,
    KmlDataSource,
    Billboard,
    LabelCollection,
    PerInstanceColorAppearance,
    Primitive,
    SceneTransforms,
    when,
    Viewer) {
    "use strict";

    var loadingIndicator = document.getElementById('loadingIndicator');
    var viewer = new Viewer('cesiumContainer', {
        selectionIndicator : false
    });

    var scene = viewer.scene;
    var camera = scene.camera;
    var handler = new ScreenSpaceEventHandler(scene.canvas);

    var kmlPromise = KmlDataSource.load('./KML/mcs.kmz');
    viewer.dataSources.add(kmlPromise);

    when(kmlPromise).then(function(dataSource) {
        var removeEventListener = scene.postRender.addEventListener(function() {
            var values = dataSource.entities.values;
            var length = values.length;

            var table = {};

            for (var i = 0; i < length; ++i) {
                var entity = values[i];

                if (defined(entity.billboard) && defined(entity.label)) {
                    var position = entity.position.getValue(viewer.clock.startTime);
                    var key = position.x.toString() + position.y.toString() + position.z.toString();

                    if (table[key]) {
                        entity.label.show = false;
                    } else {
                        entity.label.show = true;
                        table[key] = true;
                    }
                }
            }

            handler.setInputAction(function(movement) {
                // Star burst on left mouse click.
                starBurst(movement.position);
            }, ScreenSpaceEventType.LEFT_CLICK);

            handler.setInputAction(function(movement) {
                // Remove the star burst when the mouse exits the circle or show the label of the billboard the mouse is hovering over.
                updateStarBurst(movement.endPosition);
            }, ScreenSpaceEventType.MOUSE_MOVE);

            camera.moveStart.addEventListener(function() {
                // Reset the star burst on camera move because the lines from the center
                // because the line end points rely on the screen space positions of the billboards.
                undoStarBurst();
            });

            removeEventListener();
        });
    });

    // State saved across mouse click and move events
    var starBurstState = {
        enabled : false,
        pickedEntities : undefined,
        billboardEyeOffsets : undefined,
        labelEyeOffsets : undefined,
        linePrimitive : undefined,
        center : undefined,
        screenCenter : undefined,
        pixelPadding : 10.0,
        boundingRectangle : undefined
    };

    function offsetBillboard(entity, entityPosition, x, y, lines, billboardEyeOffsets, labelEyeOffsets) {
        var offset = new Cartesian2(x, y);

        var drawingBufferWidth = scene.drawingBufferWidth;
        var drawingBufferHeight = scene.drawingBufferHeight;

        var diff = Cartesian3.subtract(entityPosition, camera.positionWC, new Cartesian3());
        var distance = Cartesian3.dot(camera.directionWC, diff);

        var dimensions = camera.frustum.getPixelDimensions(drawingBufferWidth, drawingBufferHeight, distance, new Cartesian2());
        Cartesian2.multiplyByScalar(offset, Cartesian2.maximumComponent(dimensions), offset);

        var labelOffset;
        var billboardOffset = entity.billboard.eyeOffset;

        var eyeOffset = new Cartesian3(offset.x, offset.y, 0.0);
        entity.billboard.eyeOffset = eyeOffset;
        if (defined(entity.label)) {
            labelOffset = entity.label.eyeOffset;
            entity.label.eyeOffset = new Cartesian3(offset.x, offset.y, -10.0);
        }

        var endPoint = Matrix4.multiplyByPoint(camera.viewMatrix, entityPosition, new Cartesian3());
        Cartesian3.add(eyeOffset, endPoint, endPoint);
        Matrix4.multiplyByPoint(camera.inverseViewMatrix, endPoint, endPoint);
        lines.push(endPoint);

        billboardEyeOffsets.push(billboardOffset);
        labelEyeOffsets.push(labelOffset);
    }

    var labelWidthCache = {};

    function labelPixelWidth(entity) {
        var key = entity.label.text;
        var cachedValue = labelWidthCache[key];
        if (defined(cachedValue)) {
            return cachedValue;
        }

        var label;

        var primitives = scene.primitives;
        var length = primitives.length;
        for (var i = 0; i < length; ++i) {
            var primitive = primitives.get(i);
            if (primitive instanceof LabelCollection) {
                var collectionLength = primitive.length;
                for (var j = 0; j < collectionLength; ++j) {
                    var l = primitive.get(j);
                    if (l.id === entity) {
                        label = l;
                        break;
                    }
                }
            }
        }

        if (!defined(label)) {
            return 0;
        }

        var width = 0;
        var glyphs = label._glyphs;
        length = glyphs.length;
        for (var k = 0; k < length; ++k) {
            width += glyphs[k].billboard.width;
        }

        labelWidthCache[key] = width;
        return width;
    }

    function starBurst(mousePosition) {
        if (defined(starBurstState.pickedEntities)) {
            return;
        }

        var pickedObjects = scene.drillPick(mousePosition);
        if (!defined(pickedObjects) || pickedObjects.length < 2) {
            return;
        }

        var billboardEntities = [];
        var length = pickedObjects.length;
        var i;

        for (i = 0; i < length; ++i) {
            var pickedObject = pickedObjects[i];
            if (pickedObject.primitive instanceof Billboard) {
                billboardEntities.push(pickedObject);
            }
        }

        if (billboardEntities.length === 0) {
            return;
        }

        var pickedEntities = starBurstState.pickedEntities = [];
        var billboardEyeOffsets = starBurstState.billboardEyeOffsets = [];
        var labelEyeOffsets = starBurstState.labelEyeOffsets = [];
        var lines = [];
        starBurstState.maxDimension = Number.NEGATIVE_INFINITY;

        var maxDimension;
        var maxWidthWithLabels;

        var x;
        var y;

        var canvasHeight = scene.canvas.clientHeight;

        // Drill pick gets all of the entities under the mouse pointer.
        // Find the billboards and set their pixel offsets in a circle pattern.
        length = billboardEntities.length;
        i = 0;
        while (i < length) {
            var object = billboardEntities[i];
            if (pickedEntities.length === 0) {
                starBurstState.center = Cartesian3.clone(object.primitive.position);
                starBurstState.screenCenter = SceneTransforms.wgs84ToWindowCoordinates(scene, starBurstState.center);
            }

            if (!defined(x)) {
                var width = object.primitive.width;
                var height = object.primitive.height;
                maxDimension = Math.max(width, height) * object.primitive.scale + starBurstState.pixelPadding;
                maxWidthWithLabels = maxDimension;
                x = maxDimension;
                y = 0;
            }

            if (starBurstState.screenCenter.y - y > 0) {
                offsetBillboard(object.id, object.primitive.position, x, y, lines, billboardEyeOffsets, labelEyeOffsets);
                pickedEntities.push(object);

                maxWidthWithLabels = Math.max(maxWidthWithLabels, object.primitive.width);
                if (defined(object.id.label)) {
                    maxWidthWithLabels = Math.max(maxWidthWithLabels, labelPixelWidth(object.id));
                }
            } else if (starBurstState.screenCenter.y + y < canvasHeight) {
                object = billboardEntities[i];
                offsetBillboard(object.id, object.primitive.position, x, -y, lines, billboardEyeOffsets, labelEyeOffsets);
                pickedEntities.push(object);

                maxWidthWithLabels = Math.max(maxWidthWithLabels, object.primitive.width);
                if (defined(object.id.label)) {
                    maxWidthWithLabels = Math.max(maxWidthWithLabels, labelPixelWidth(object.id));
                }

                y += maxDimension;
            }

            if (i + 1 < length && y > 0 && starBurstState.screenCenter.y + y < canvasHeight) {
                object = billboardEntities[++i];
                offsetBillboard(object.id, object.primitive.position, x, -y, lines, billboardEyeOffsets, labelEyeOffsets);
                pickedEntities.push(object);

                maxWidthWithLabels = Math.max(maxWidthWithLabels, object.primitive.width);
                if (defined(object.id.label)) {
                    maxWidthWithLabels = Math.max(maxWidthWithLabels, labelPixelWidth(object.id));
                }
            }

            y += maxDimension;
            if (starBurstState.screenCenter.y - y < 0 && starBurstState.screenCenter.y + y > canvasHeight) {
                x += maxWidthWithLabels * 1.5;
                y = 0;
                maxWidthWithLabels = 0;
            }

            ++i;
        }

        var rect = new BoundingRectangle();
        rect.x = starBurstState.screenCenter.x - starBurstState.pixelPadding * 2.0;
        rect.width = x + maxWidthWithLabels * 2.0;
        starBurstState.boundingRectangle = rect;


        // Add lines from the pick center out to the translated billboard.
        var instances = [];
        length = lines.length;
        for (i = 0; i < length; ++i) {
            var pickedEntity = pickedEntities[i];
            starBurstState.maxDimension = Math.max(pickedEntity.primitive.width, pickedEntity.primitive.height, starBurstState.maxDimension);

            if (defined(pickedEntity.id.label)) {
                pickedEntity.id.label.show = true;
            }

            instances.push(new GeometryInstance({
                geometry : new SimplePolylineGeometry({
                    positions : [starBurstState.center, lines[i]],
                    followSurface : false,
                    granularity : CesiumMath.PI_OVER_FOUR
                }),
                attributes : {
                    color : ColorGeometryInstanceAttribute.fromColor(Color.WHITE)
                }
            }));
        }

        starBurstState.linePrimitive = scene.primitives.add(new Primitive({
            geometryInstances : instances,
            appearance : new PerInstanceColorAppearance({
                flat : true,
                translucent : false
            }),
            asynchronous : false
        }));

        viewer.selectedEntity = undefined;
        starBurstState.x = x;
        starBurstState.y = y;
    }

    function updateStarBurst(mousePosition) {
        if (!defined(starBurstState.pickedEntities)) {
            return;
        }

        if (!starBurstState.enabled) {
            // For some reason we get a mousemove event on click, so
            // do not show a label on the first event.
            starBurstState.enabled = true;
            return;
        }

        // Remove the star burst if the mouse exits the screen space circle.
        // If the mouse is inside the circle, show the label of the billboard the mouse is hovering over.

        var boundingRectangle = starBurstState.boundingRectangle;
        if (mousePosition.x < boundingRectangle.x || mousePosition.x > boundingRectangle.x + boundingRectangle.width) {
            undoStarBurst();
        }
    }

    function undoStarBurst() {
        var pickedEntities = starBurstState.pickedEntities;
        if (!defined(pickedEntities)) {
            return;
        }

        var billboardEyeOffsets = starBurstState.billboardEyeOffsets;
        var labelEyeOffsets = starBurstState.labelEyeOffsets;

        // Reset billboard and label pixel offsets.
        // Hide overlapping labels.
        for (var i = 0; i < pickedEntities.length; ++i) {
            var entity = pickedEntities[i].id;
            entity.billboard.eyeOffset = billboardEyeOffsets[i];
            if (defined(entity.label)) {
                entity.label.eyeOffset = labelEyeOffsets[i];
                entity.label.show = false;
            }
        }

        // Remove lines from the scene.
        // Free resources and reset state.
        scene.primitives.remove(starBurstState.linePrimitive);
        starBurstState.linePrimitive = undefined;
        starBurstState.pickedEntities = undefined;
        starBurstState.billboardEyeOffsets = undefined;
        starBurstState.labelEyeOffsets = undefined;
        starBurstState.enabled = false;
    }

    loadingIndicator.style.display = 'none';
});