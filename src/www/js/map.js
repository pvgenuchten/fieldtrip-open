/*
Copyright (c) 2014, EDINA.
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this
   list of conditions and the following disclaimer in the documentation and/or
   other materials provided with the distribution.
3. All advertising materials mentioning features or use of this software must
   display the following acknowledgement: This product includes software
   developed by the EDINA.
4. Neither the name of the EDINA nor the names of its contributors may be used to
   endorse or promote products derived from this software without specific prior
   written permission.

THIS SOFTWARE IS PROVIDED BY EDINA ''AS IS'' AND ANY EXPRESS OR IMPLIED
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
SHALL EDINA BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
DAMAGE.
*/

"use strict";

define(['ext/openlayers', 'records', 'utils', 'config', 'proj4js'], function(ol, records, utils, config, proj4js){
    var RESOLUTIONS = [1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1];
    var MIN_LOCATE_ZOOM_TO = RESOLUTIONS.length - 3;
    var POST_LOCATE_ZOOM_TO = RESOLUTIONS.length - 1;

    var INTERNAL_PROJECTION;
    var EXTERNAL_PROJECTION = new OpenLayers.Projection("EPSG:4326")

    var DEFAULT_USER_LON = -2.421976;
    var DEFAULT_USER_LAT = 53.825564;
    var GPS_ACCURACY_FLAG = false;
    //var GPS_LOCATE_TIMEOUT = 10000;
    var GPS_LOCATE_TIMEOUT = 3000;

    var ANNOTATE_POSITION_ATTR = 'annotate_pos';
    var USER_POSITION_ATTR = 'user_pos';

    var baseLayer;
    if(config.map_baselayer === 'osm'){
        INTERNAL_PROJECTION = new OpenLayers.Projection('EPSG:900913')
        baseLayer = new OpenLayers.Layer.OSM();
    }
    else{
        // TODO - this should be put into config

        var proj = "EPSG:27700";
        proj4js.defs[proj] = "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs";
        console.log(proj4js);
        INTERNAL_PROJECTION = new OpenLayers.Projection(proj)
        baseLayer = new OpenLayers.Layer.TMS(
            "osOpen",
            "http://fieldtripgb.edina.ac.uk/mapcache/tms",
            {
                layername: "fieldtripgb@BNG",
                type: "jpg",
                serviceVersion: "1.0.0",
                isBaseLayer: true,
            }
        );
    }

    /**
     * Display all annotations on speficied layer.
     * @param layer The layer to use.
     */
    var showAnnotations = function(layer){
        var features = [];

        //Utils.printObj(records.getSavedrecords());

        $.each(records.getSavedRecords(), function(id, annotation){
            var record = annotation.record;
            if(record.point !== undefined){
                features.push(new OpenLayers.Feature.Vector(
                    new OpenLayers.Geometry.Point(record.point.lon,
                                                  record.point.lat),
                    {
                        'id': id,
                        'type': records.getEditorId(annotation)
                    }
                ));
            }
            else{
                console.debug("record " + id + " has no location");
            }
        });

        layer.addFeatures(features);
    };

var _this = {

    /**
     * Set up openlayer map.
     */
    init: function(){
        var options = {
            controls: [],
            projection: INTERNAL_PROJECTION,
            units: 'm',
            resolutions: RESOLUTIONS,
            maxExtent: new OpenLayers.Bounds (0,0,700000,1300000),
            theme: null,
        }

        this.map = new OpenLayers.Map("map", options);
        this.map.addLayer(baseLayer);

        // styles for records
        var recordsStyle = new OpenLayers.Style({
            pointRadius: 20,
            // labels don't work on android
            //label : "${title}",
            graphicOpacity: 1,
            graphicZIndex: 1
        });

        // annotation styles
        recordsStyle.addRules([
            new OpenLayers.Rule({
                filter: new OpenLayers.Filter.Comparison({
                    type: OpenLayers.Filter.Comparison.EQUAL_TO,
                    property: 'type',
                    value: 'audio',
                }),
                symbolizer: {
                    externalGraphic: 'css/images/audiomarker.png',
                    graphicWidth: 35,
                    graphicHeight: 50,
                    graphicYOffset: -50
                }
            }),
            new OpenLayers.Rule({
                filter: new OpenLayers.Filter.Comparison({
                    type: OpenLayers.Filter.Comparison.EQUAL_TO,
                    property: 'type',
                    value: 'image',
                }),
                symbolizer: {
                    externalGraphic: 'css/images/imagemarker.png',
                    graphicWidth: 35,
                    graphicHeight: 50,
                    graphicYOffset: -50
                }
            }),
            new OpenLayers.Rule({
                filter: new OpenLayers.Filter.Comparison({
                    type: OpenLayers.Filter.Comparison.EQUAL_TO,
                    property: 'type',
                    value: 'text',
                }),
                symbolizer: {
                    externalGraphic: 'css/images/textmarker.png',
                    graphicWidth: 35,
                    graphicHeight: 50,
                    graphicYOffset: -50
                }
            }),
            // an annotation with no photo, text or audio is a custom annotations
            new OpenLayers.Rule({
                elseFilter: true,
                symbolizer: {
                    externalGraphic: 'css/images/custommarker.png',
                    graphicWidth: 35,
                    graphicHeight: 50,
                    graphicYOffset: -50
                }
            })
        ]);

        // vector layer for displaying records
        var styleMap = new OpenLayers.StyleMap({'default': recordsStyle});
        var recordsLayer = new OpenLayers.Layer.Vector(
            'recordsLayer',
            {
                visibility: false,
                styleMap: styleMap
            }
        );

        // vector layer for dragging position marker
        var positionMarkerStyle = OpenLayers.Util.extend({}, OpenLayers.Feature.Vector.style['default']);
        positionMarkerStyle.graphicOpacity = 1;
        positionMarkerStyle.graphicWidth = 65;
        positionMarkerStyle.graphicHeight = 64;
        positionMarkerStyle.externalGraphic = "css/images/marker.png";
        positionMarkerStyle.graphicYOffset = -64;

        var positionMarkerLayer = new OpenLayers.Layer.Vector(
            'positionMarker',
            {
                style: positionMarkerStyle,
                visibility: false
            }
        );

        // user location layer
        var locateLayerStyle = OpenLayers.Util.extend({}, OpenLayers.Feature.Vector.style['default']);
        locateLayerStyle.externalGraphic = "css/images/user.png";
        locateLayerStyle.graphicWidth = 20;
        locateLayerStyle.graphicHeight = 20;
        locateLayerStyle.graphicOpacity = 1;
        locateLayerStyle.rotation = "${imageRotation}";
        var locateLayer = new OpenLayers.Layer.Vector(
            'locate',
            {
                style: locateLayerStyle,
            }
        );

        // add layers to map
        this.map.addLayers([positionMarkerLayer,
                            recordsLayer,
                            locateLayer]);

        var TN = OpenLayers.Class(OpenLayers.Control.TouchNavigation, {
            defaultClick: $.proxy(this.showRecordDetail, this),
        });

        // this will allow non apps to work
        var select = new OpenLayers.Control.SelectFeature(recordsLayer);
        this.map.addControl(select);
        select.activate();

        this.map.addControl(new OpenLayers.Control.Attribution());
        this.map.addControl(new TN({
            dragPanOptions: {
                enableKinetic: true
            },
            pinchZoomOptions: {
                autoActivate: true
            }
        }));

        //this.map.zoomTo(2);

        this.map.addControl(new OpenLayers.Control.ScaleLine({geodesic: true}));

        // create default user position
        this.userLonLat = new OpenLayers.LonLat(
            DEFAULT_USER_LON,
            DEFAULT_USER_LAT);
        this.userLonLat.gpsPosition = {
            longitude: DEFAULT_USER_LON,
            latitude: DEFAULT_USER_LAT,
            heading: 130,
            altitude: 150
        };

        var drag = new OpenLayers.Control.DragFeature(positionMarkerLayer);
        this.map.addControl(drag);
        drag.activate();
    },

    /**
     * Render the map on a defined div.
     * @param div The div id.
     */
    display: function(div){
        this.map.render(div);
    },

    /**
     * @return layer with the draggable icon.
     */
    getAnnotateLayer: function(){
        return this.getLayer('positionMarker');
    },

    /**
     * get current annotation coords.
     * @param wgs84 In WGS84? If not national grid.
     * @return Current annotation coordinates.
     */
    getAnnotationCoords: function(wgs84){
        var coords = undefined;
        var features = this.getAnnotateLayer().getFeaturesByAttribute(
            'id',
            ANNOTATE_POSITION_ATTR);

        if(features.length > 0){
            var geom = features[0].geometry;
            coords = new OpenLayers.LonLat(geom.x, geom.y);
            if(wgs84){
                coords = this.toWGS84(coords);
            }

            // give the annotation altitude the altitude of the user
            // see https://redmine.edina.ac.uk/issues/5497
            coords.gpsPosition = this.userLonLat.gpsPosition;
        }

        return coords;
    },

    /**
     * @return layer with the user icon.
     */
    getLocateLayer: function(){
        return this.getLayer('locate');
    },

    /**
     * @param layerName
     * @return Openlayers layer by name.
     */
    getLayer: function(layerName){
        var layer = this.map.getLayersByName(layerName);

        if(layer){
            return layer[0];
        }
        else{
            return;
        }
    },

    /**
     * @return Records vector layer.
     */
    getRecordsLayer: function(){
        return this.getLayer('recordsLayer');
    },

    /**
     * Locate user on map.
     * @param interval Time gap between updates. If 0 update only once.
     * @param secretly If true do not show page loading msg.
     * @param updateAnnotateLayer Should annotate layer be informed of new position?
     * @param useDefault If no user location found should default be used?
     */
    geoLocate: function(options){
        console.debug("Geolocate user: interval: " + options.interval +
                      " secretly: " + options.secretly +
                      " updateAnnotateLayer: " + options.updateAnnotateLayer +
                      " useDefault " + options.useDefault);

        if(!options.secretly){
            utils.inform('Waiting for GPS fix',10000);
        }

        // found user location
        var onSuccess = $.proxy(function(position){
            console.debug("Position found: "+ position.coords.latitude + "," + position.coords.longitude);
            this.onPositionSuccess(position, options.updateAnnotateLayer);
            $.mobile.hidePageLoadingMsg();
        }, this);

        // problem with geo locate
        var onError = $.proxy(function(error){
            if(error.code === 3){
                // timeout
                console.debug("GPS timed out: " + error.code);
                if(!options.secretly){
                    utils.inform('GPS timed out', 5000);
                }
            }
            else{
                console.debug("GPS is not enabled");
                if(!options.secretly){
                    utils.inform('Your GPS needs to be enabled.', 5000);
                }
            }

            if(options.useDefault){
                //  just go to center of UK
                var pos = {
                    coords: {
                        longitude: DEFAULT_USER_LON,
                        latitude: DEFAULT_USER_LAT,
                        heading: 130,
                        altitude: 150
                    }
                }

                var dontHideLoadingDialog = true;
                this.onPositionSuccess(pos,
                                       options.updateAnnotateLayer,
                                       dontHideLoadingDialog);
            }
        }, this);

        // clear watch if already defined
        if(this.geoLocationWatchID){
            navigator.geolocation.clearWatch(this.geoLocationWatchID);
        }

        // if interval is defined create a watch
        if(options.interval > 0){
            this.geoLocationWatchID = navigator.geolocation.watchPosition(
                onSuccess,
                onError,
                {
                    enableHighAccuracy: GPS_ACCURACY_FLAG,
                    maximumAge: options.interval,
                    timeout: this.geolocateTimeout
                }
            );
        }
        else{
            navigator.geolocation.getCurrentPosition(
                onSuccess,
                onError,
                {
                    enableHighAccuracy: GPS_ACCURACY_FLAG,
                    timeout: this.geolocateTimeout
                }
            );
        }
    },

    /**
     * TODO
     */
    geolocateTimeout: GPS_LOCATE_TIMEOUT,

    /**
     * Hide annotation layer.
     */
    hideAnnotateLayer: function(){
        this.getAnnotateLayer().setVisibility(false);
    },

    /**
     * Remove all annotations / records from map.
     */
    hideRecordsLayer: function(){
        this.getRecordsLayer().setVisibility(false);

        $.each(this.map.layers, function(i, layer){
            // GPS tracks are on a seperate layer beginning with 'gps-track-'
            if(layer.name.substr(0, 10) === 'gps-track-'){
                layer.setVisibility(false);
            }
        });
    },

    /**
     * Receive a new user position.
     * @param position The GPS position http://docs.phonegap.com/en/2.1.0/cordova_geolocation_geolocation.md.html#Position.
     * @param updateAnnotateLayer Should annotate layer be updated after position
     * success?
     */
    onPositionSuccess: function(position,
                                updateAnnotateLayer,
                                dontHideLoadingDialog){
        this.userLonLat = new OpenLayers.LonLat(
            position.coords.longitude,
            position.coords.latitude);
        this.userLonLat.gpsPosition = position.coords;

        if(position.coords.heading){
            if(this.getAnnotateLayer().features.length > 0){
                // set rotation to heading direction, doesn't work opn most android
                // devices, see http://devel.edina.ac.uk:7775/issues/4852
                this.getAnnotateLayer().features[0].attributes.imageRotation =
                    360 - position.coords.heading;
            }
        }

        // update user position
        this.updateLocateLayer();

        // if necessary update annotate pin
        if(updateAnnotateLayer){
            // TODO
            this.updateAnnotateLayer(this.toMercator(this.userLonLat));
            //this.updateAnnotateLayer(this.userLonLat);

        }
        if(dontHideLoadingDialog !== true){
            $.mobile.hidePageLoadingMsg();
        }
    },

    /**
     * Sledgehammer approach to refreshing annotations.
     * @param annotation The annotation to centre on.
     */
    refreshRecords: function(annotation){
        this.getRecordsLayer().removeAllFeatures();
        this.showRecordsLayer(annotation);
    },

    /**
     * Centre map with zoom level.
     * @param lon
     * @param lat
     * @param zoom
     * @param wgs84
     */
    setCentre: function(lon, lat, zoom, wgs84){
        var lonlat;
        if(wgs84){
            lonlat = toNationalGrid(new OpenLayers.LonLat(lon, lat));
        }
        else{
            lonlat = new OpenLayers.LonLat(lon, lat);
        }

        if(!zoom){
            zoom = this.map.getZoom();
        }

        this.map.setCenter(lonlat, zoom);
    },

    /**
     * Show annotation marker.
     */
    showAnnotateLayer: function(){
        this.getAnnotateLayer().setVisibility(true);
    },

    /**
     * Show user's position.
     */
    showLocateLayer: function(){
        this.getLocateLayer().setVisibility(true);
    },

    /**
     * Show details of a single annotation.
     * @param evt Map Click event.
     */
    showRecordDetail: function(evt){
        var feature = this.getRecordsLayer().getFeatureFromEvent(evt);
        if(feature){
            var annotation = records.getSavedRecord(feature.attributes.id);
            $(document).off('pageinit', '#record-details-page');
            $(document).on('pageinit', '#record-details-page', function(event) {
                $('#record-details-detail').text('');
                $('#record-details-header h1').text(annotation.record.name);
                var width = $('#record-details-page').width() / 1.17;

                var showRecord = function(html){
                    $('#record-details-detail').append(html).trigger('create');
                };

                $.each(annotation.record.fields, function(i, entry){
                    var html;
                    var type = records.typeFromId(entry.id);

                    if(type === 'image'){
                        html = '<img src="' + entry.val + '" width="' + width + '"/>';
                        showRecord(html);
                    }
                    else if(type === 'audio'){
                        require(['audio'], function(audio){
                            html = audio.getNode(entry.val, entry.label + ':');
                            showRecord(html);
                        });
                    }
                    else if(entry.id !== 'text0'){ // ignore title element
                        html = '<p><span>' + entry.label + '</span>: ' +
                            entry.val + '</p>';
                        showRecord(html);
                    }
                });
            });

            // TODO
            // if(feature.attributes.type === 'track'){
            //     this.showGPSTrack(feature.attributes.id, annotation);
            // }
            //else{
            $.mobile.changePage('record-details.html', {role: "dialog"});
            //}
        }
    },

    /**
     * Display records on map.
     */
    showRecordsLayer: function(annotation){
        var layer = this.getRecordsLayer();
        if(layer.features.length === 0){
            showAnnotations(layer);
        }

        if(annotation){
            this.setCentre(annotation.record.point.lon,
                           annotation.record.point.lat,
                           undefined,
                           false);
        }

        layer.setVisibility(true);
        layer.refresh();
    },

    /**
     * TODO
     */
    toMercator: function(lonlat){
        var clone = lonlat.clone();
        clone.transform(
            EXTERNAL_PROJECTION,   //
            INTERNAL_PROJECTION);  // to mercator

        if(typeof(clone.gpsPosition) !== 'undefined'){
            clone.gpsPosition = lonlat.gpsPosition;
        }

        return clone;
    },

    /**
     * Reproject a mercator latlon to wgs84.
     * @param lonlat Mercator lonlat.
     * @return WGS84 lonlat
     */
    toWGS84: function(lonlat){
        return lonlat.clone().transform(
            INTERNAL_PROJECTION, // from mercator
            EXTERNAL_PROJECTION); //
    },


    /**
     * Update annotate layer.
     * @param lonlat The position (in national grid) of the annotation icon, if
     * undefined use the centre of the map.
     */
    updateAnnotateLayer: function(lonlat){
        if(lonlat === undefined){
            lonlat = this.map.getCenter();
        }

        this.updateLayer(this.getAnnotateLayer(),
                         ANNOTATE_POSITION_ATTR,
                         undefined,
                         lonlat);
    },

    /**
     * Update a vector layer centred on users location.
     * @param layer The layer to update.
     * @id The id of the user icon feature.
     * @zoom The map zoom level to zoom to.
     * @lonLat The current location of the user.
     */
    updateLayer: function(layer, id, zoom, lonLat){
        var annotationFeature = layer.getFeaturesByAttribute('id', id);
        if(lonLat === undefined || lonLat === null){
            // TODO - what about OS
            //lonLat = toNationalGrid(this.userLonLat);
            lonLat = this.toMercator(this.userLonLat);
        }

        var point = new OpenLayers.Geometry.Point(lonLat.lon, lonLat.lat);
        var v = new OpenLayers.Feature.Vector(point,
                                              {'id': id});

        if(lonLat.gpsPosition){
            point.gpsPosition = lonLat.gpsPosition;
        }

        if(annotationFeature.length === 0){
            annotationFeature = [v];
            layer.addFeatures(annotationFeature);
        }
        else {
            annotationFeature[0].move(lonLat);
        }

        layer.setVisibility(true);
        layer.redraw();

        this.map.setCenter(lonLat, zoom);
    },

    /**
     * Update locate layer with users geo location.
     */
    updateLocateLayer: function(){
        var zoom = this.map.getZoom();
        if(zoom < MIN_LOCATE_ZOOM_TO){
            zoom = POST_LOCATE_ZOOM_TO;
        }

        this.updateLayer(this.getLocateLayer(), USER_POSITION_ATTR, zoom);
    },

    /**
     * Update map size after dynamic change in map size.
     */
    updateSize: function(){
        this.map.updateSize();
    },

    /**
     * Zoom map in one level.
     */
    zoomIn: function(){
        this.map.zoomIn();
    },

    /**
     * Zoom map out one level.
     */
    zoomOut: function(){
        this.map.zoomOut();
    },

};

return _this;

});
