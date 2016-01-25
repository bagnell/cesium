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
    'Cesium/Core/defined',
    'Cesium/Core/ScreenSpaceEventHandler',
    'Cesium/Core/ScreenSpaceEventType',
    'Cesium/DataSources/KmlDataSource',
    'Cesium/Scene/Billboard',
    'Cesium/Scene/SceneTransforms',
    'Cesium/Widgets/Viewer/Viewer',
    'domReady!'
], function(
    BoundingRectangle,
    Cartesian2,
    Cartesian3,
    defined,
    ScreenSpaceEventHandler,
    ScreenSpaceEventType,
    KmlDataSource,
    Billboard,
    SceneTransforms,
    Viewer) {
    "use strict";


    var loadingIndicator = document.getElementById('loadingIndicator');
    var viewer = new Viewer('cesiumContainer', {
        selectionIndicator : false
    });
    viewer.dataSources.add(KmlDataSource.load('./KML/mcs.kmz'));

    var scene = viewer.scene;

    var pickedEntities;
    var rectangle;
    var centerPosition = new Cartesian3();
    var padding = 10.0;

    var handler = new ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction(function(movement) {
        if (!defined(pickedEntities)) {
            var pickedObjects = scene.drillPick(movement.position);
            if (defined(pickedObjects) && pickedObjects.length > 1) {
                pickedEntities = [];

                var x = 0.0;
                var y = 0.0;
                var width = 0.0;
                var height = 0.0;

                var dirX = 1.0;
                var dirY = 0.0;

                var maxX = 0.0;
                var minX = 0.0;
                var maxY = 0.0;
                var minY = 0.0;

                var maxWidth = Number.NEGATIVE_INFINITY;
                var maxHeight = Number.NEGATIVE_INFINITY;

                for (var i = 0; i < pickedObjects.length; ++i) {
                    var object = pickedObjects[i];
                    if (object.primitive instanceof Billboard) {
                        if (pickedEntities.length === 0) {
                            Cartesian3.clone(object.primitive.position, centerPosition);
                        }

                        pickedEntities.push(object);

                        var offset = new Cartesian2(x, y);
                        object.id.billboard.pixelOffset = offset;
                        if (defined(object.id.label)) {
                            object.id.label.pixelOffset = offset;
                            object.id.label.show = false;
                        }

                        var objectWidth = object.primitive.width + padding;
                        var objectHeight = object.primitive.height + padding;
                        x += objectWidth * dirX;
                        y += objectHeight * dirY;

                        maxX = Math.max(maxX, x);
                        minX = Math.min(minX, x);
                        maxY = Math.max(maxY, y);
                        minY = Math.min(minY, y);

                        maxWidth = Math.max(objectWidth, maxWidth);
                        maxHeight = Math.max(objectHeight, maxHeight);

                        var w = maxX - minX;
                        var h = maxY - minY;

                        if (w > width) {
                            width = w

                            dirY = dirX > 0.0 ? 1.0 : -1.0;
                            dirX = 0.0;
                        }
                        if (h > height) {
                            height = h;

                            dirX = dirY > 0.0 ? -1.0 : 1.0;
                            dirY = 0.0;
                        }
                    }
                }

                if (width > 0.0 || height > 0.0) {
                    rectangle = new BoundingRectangle();
                    rectangle.width = width + maxWidth;
                    rectangle.height = height + maxHeight;

                    viewer.selectedEntity = undefined;
                } else {
                    pickedEntities = undefined;
                }
            }
        }
    }, ScreenSpaceEventType.LEFT_CLICK);

    var currentObject;

    handler.setInputAction(function(movement) {
        if (defined(rectangle)) {
            var screenPosition = SceneTransforms.wgs84ToWindowCoordinates(scene, centerPosition);
            screenPosition.x -= rectangle.width * 0.5;
            screenPosition.y -= rectangle.height * 0.5;

            var position = movement.endPosition;
            if (position.x < screenPosition.x || position.x > screenPosition.x + rectangle.width ||
                position.y < screenPosition.y || position.y > screenPosition.y + rectangle.height) {
                for (var i = 0; i < pickedEntities.length; ++i) {
                    var entity = pickedEntities[i].id;
                    entity.billboard.pixelOffset = new Cartesian2(0.0, 0.0);
                    if (defined(entity.label)) {
                        entity.label.pixelOffset = new Cartesian2(0.0, 0.0);
                        entity.label.show = false;
                    }
                }
                pickedEntities = undefined;
                rectangle = undefined;
            } else {
                var pickedObject = scene.pick(movement.endPosition);
                if (pickedObject !== currentObject) {
                    if (defined(pickedObject) && pickedObject.primitive instanceof Billboard && defined(pickedObject.id.label)) {
                        if (defined(currentObject)) {
                            currentObject.id.label.show = false;
                        }

                        currentObject = pickedObject;
                        pickedObject.id.label.show = true;
                        pickedObject.id.label.eyeOffset = new Cartesian3(0.0, 0.0, -100.0);
                    } else if (defined(currentObject)) {
                        currentObject.id.label.show = false;
                        currentObject = undefined;
                    }
                }
            }
        }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    loadingIndicator.style.display = 'none';
});