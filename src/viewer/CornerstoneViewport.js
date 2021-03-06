import { Component } from 'react';
import React from 'react';
import * as cornerstone from 'cornerstone-core';
import * as cornerstoneTools from 'cornerstone-tools';
import './lib/initCornerstone.js';
import debounce from './lib/debounce.js';
import ImageScrollbar from './ImageScrollbar.js';
import ViewportOverlay from './ViewportOverlay.js';
import LoadingIndicator from '../shared/LoadingIndicator.js';
import './CornerstoneViewport.css';

const EVENT_RESIZE = 'resize';
const loadIndicatorDelay = 25;
const { loadHandlerManager } = cornerstoneTools;

function setAllToolsPassive() {
  cornerstoneTools.store.state.tools.forEach(tool => {
    cornerstoneTools.setToolPassive(tool.name);
  });
}

function initializeTools(tools) {
  Array.from(tools).forEach(toolName => {
    const apiTool = cornerstoneTools[`${toolName}Tool`];
    if (apiTool) {
      cornerstoneTools.addTool(apiTool);
      console.log('Added:');
      console.log(apiTool.name);
    } else {
      throw new Error(`Tool not found: ${toolName}Tool`);
    }
  });
}

const scrollToIndex = cornerstoneTools.import('util/scrollToIndex');

class CornerstoneViewport extends Component {
  constructor(props) {
    super(props);

    const stack = props.viewportData.stack;

    // TODO: Allow viewport as a prop
    this.state = {
      stack,
      imageId: stack.imageIds[0],
      viewportHeight: '100%'
    };

    this.displayScrollbar = stack.imageIds.length > 1;
    this.state.viewport = cornerstone.getDefaultViewport(null, undefined);

    this.onImageRendered = this.onImageRendered.bind(this);
    this.onNewImage = this.onNewImage.bind(this);
    this.onWindowResize = this.onWindowResize.bind(this);
    this.onImageLoaded = this.onImageLoaded.bind(this);
    this.onStackScroll = this.onStackScroll.bind(this);
    this.startLoadingHandler = this.startLoadingHandler.bind(this);
    this.doneLoadingHandler = this.doneLoadingHandler.bind(this);

    this.isLoading = true;
    this.loadHandlerTimeout = null;
    loadHandlerManager.setStartLoadHandler(this.startLoadingHandler);
    loadHandlerManager.setEndLoadHandler(this.doneLoadingHandler);

    this.debouncedResize = debounce(() => {
      cornerstone.resize(this.element, true);

      this.setState({
        viewportHeight: `${this.element.clientHeight - 20}px`
      });
    }, 300);

    const slideTimeoutTime = 5;
    this.slideTimeout = null;

    // Adding input listener
    this.imageSliderOnInputCallback = value => {
      // Note that we throttle requests to prevent the
      // user's ultrafast scrolling from firing requests too quickly.
      clearTimeout(this.slideTimeout);
      this.slideTimeout = setTimeout(() => {
        const newImageIdIndex = parseInt(value, 10);

        // TODO: This doesn't seem to be exported in Tools V3
        scrollToIndex(this.element, newImageIdIndex);
      }, slideTimeoutTime);
    };
  }

  render() {
    return (
      <>
        <div
          className="CornerstoneViewport viewportElement"
          onContextMenu={this.onContextMenu}
          ref={input => {
            this.element = input;
          }}
        >
          <canvas className="cornerstone-canvas" />

          {this.state.isLoading && <LoadingIndicator />}
          <ViewportOverlay
            viewport={this.state.viewport}
            imageId={this.state.imageId}
          />
        </div>
        {this.displayScrollbar && (
          <ImageScrollbar
            onInputCallback={this.imageSliderOnInputCallback}
            max={this.state.stack.imageIds.length - 1}
            value={this.state.stack.currentImageIdIndex}
            height={this.state.viewportHeight}
          />
        )}
      </>
    );
  }

  onContextMenu(event) {
    // Preventing the default behaviour for right-click is essential to
    // allow right-click tools to work.
    event.preventDefault();
  }

  onWindowResize() {
    console.log('onWindowResize');
    this.debouncedResize();
  }

  onImageRendered() {
    const viewport = cornerstone.getViewport(this.element);

    this.setState({
      viewport
    });
  }

  onNewImage() {
    const image = cornerstone.getImage(this.element);

    this.setState({
      imageId: image.imageId
    });
  }

  componentDidMount() {
    const element = this.element;

    // Enable the DOM Element for use with Cornerstone
    cornerstone.enable(element);

    // Load the first image in the stack
    cornerstone.loadAndCacheImage(this.state.imageId).then(image => {
      try {
        cornerstone.getEnabledElement(element);
      } catch (error) {
        // Handle cases where the user ends the session before the image is displayed.
        console.error(error);
        return;
      }

      // Display the first image
      cornerstone.displayImage(element, image);

      // Clear any previous tool state
      cornerstoneTools.clearToolState(this.element, 'stack');

      // Disable stack prefetch in case there are still queued requests
      cornerstoneTools.stackPrefetch.disable(this.element);

      // Add the stack tool state to the enabled element
      const stack = this.state.stack;
      cornerstoneTools.addStackStateManager(element, ['stack']);
      cornerstoneTools.addToolState(element, 'stack', stack);
      cornerstoneTools.stackPrefetch.enable(this.element);

      const tools = [
        'Length',
        'Wwwc',
        'Zoom',
        'Pan',
        'StackScroll',
        'PanMultiTouch',
        'ZoomTouchPinch',
        'StackScrollMouseWheel'
        //"StackScrollMultiTouch",
      ];

      initializeTools(tools);

      cornerstoneTools.setToolActive(this.props.activeTool, {
        mouseButtonMask: 1,
        isTouchActive: true
      });

      /* For touch devices, by default we activate:
      - Pinch to zoom
      - Two-finger Pan
      - Three (or more) finger Stack Scroll
      */
      cornerstoneTools.setToolActive('PanMultiTouch', {
        mouseButtonMask: 0,
        isTouchActive: true
      });
      cornerstoneTools.setToolActive('ZoomTouchPinch', {
        mouseButtonMask: 0,
        isTouchActive: true
      });
      //cornerstoneTools.setToolActive("StackScrollMultiTouch", { mouseButtonMask: 0, isTouchActive: true });
      /*
      cornerstoneTools.PanMultiTouch.setConfiguration({
        testPointers: eventData => eventData.numPointers === 2
      });
      */

      cornerstoneTools.stackPrefetch.setConfiguration({
        maxImagesToPrefetch: Infinity,
        preserveExistingPool: false,
        maxSimultaneousRequests: 20
      });

      /* For mouse devices, by default we turn on:
      - Stack scrolling by mouse wheel
      - Stack scrolling by keyboard up / down arrow keys
      - Pan with middle click
      - Zoom with right click
      */

      // pan is the default tool for middle mouse button
      cornerstoneTools.setToolActive('Pan', {
        mouseButtonMask: 4,
        isTouchActive: false
      });

      // zoom is the default tool for right mouse button
      cornerstoneTools.setToolActive('Zoom', {
        mouseButtonMask: 2,
        isTouchActive: false
      });

      cornerstoneTools.setToolActive('StackScrollMouseWheel', {
        mouseButtonMask: 0,
        isTouchActive: true
      });

      element.addEventListener(
        cornerstone.EVENTS.IMAGE_RENDERED,
        this.onImageRendered
      );

      element.addEventListener(cornerstone.EVENTS.NEW_IMAGE, this.onNewImage);

      element.addEventListener(
        cornerstoneTools.EVENTS.STACK_SCROLL,
        this.onStackScroll
      );

      element.addEventListener(
        cornerstoneTools.EVENTS.MEASUREMENT_ADDED,
        this.onMeasurementAdded
      );

      cornerstone.events.addEventListener(
        cornerstone.EVENTS.IMAGE_LOADED,
        this.onImageLoaded
      );

      window.addEventListener(EVENT_RESIZE, this.onWindowResize);

      this.setState({
        viewportHeight: `${this.element.clientHeight - 20}px`
      });
    });
  }

  componentWillUnmount() {
    const element = this.element;
    element.removeEventListener(
      cornerstone.EVENTS.IMAGE_RENDERED,
      this.onImageRendered
    );

    element.removeEventListener(cornerstone.EVENTS.NEW_IMAGE, this.onNewImage);

    element.removeEventListener(
      cornerstoneTools.EVENTS.STACK_SCROLL,
      this.onStackScroll
    );

    element.removeEventListener(
      cornerstoneTools.EVENTS.MEASUREMENT_ADDED,
      this.onMeasurementAdded
    );

    window.removeEventListener(EVENT_RESIZE, this.onWindowResize);

    cornerstone.disable(element);

    cornerstone.events.removeEventListener(
      cornerstone.EVENTS.IMAGE_LOADED,
      this.onImageLoaded
    );
  }

  componentDidUpdate(prevProps) {
    // TODO: Add a real object shallow comparison here?
    if (
      this.state.stack.imageIds[0] !== this.props.viewportData.stack.imageIds[0]
    ) {
      this.setState({
        stack: this.props.viewportData.stack
      });

      const stackData = cornerstoneTools.getToolState(this.element, 'stack');
      let currentStack = stackData && stackData.data[0];

      if (!currentStack) {
        currentStack = {
          currentImageIdIndex: this.state.stack.currentImageIdIndex,
          imageIds: this.state.stack.imageIds
        };

        cornerstoneTools.addStackStateManager(this.element, ['stack']);
        cornerstoneTools.addToolState(this.element, 'stack', currentStack);
      } else {
        // TODO: we should make something like setToolState by an ID
        currentStack.currentImageIdIndex = this.state.stack.currentImageIdIndex;
        currentStack.imageIds = this.state.stack.imageIds;
      }

      const imageId = currentStack.imageIds[currentStack.currentImageIdIndex];

      cornerstone.loadAndCacheImage(imageId).then(image => {
        cornerstone.displayImage(this.element, image);

        cornerstoneTools.stackPrefetch.disable(this.element);
        cornerstoneTools.stackPrefetch.enable(this.element);
      });
    }

    if (this.props.activeTool !== prevProps.activeTool) {
      setAllToolsPassive();

      cornerstoneTools.setToolActive(this.props.activeTool, {
        mouseButtonMask: 1,
        isTouchActive: true
      });

      // TODO: Why do we need to do this in v3?
      cornerstoneTools.setToolActive('StackScrollMouseWheel', {
        mouseButtonMask: 0,
        isTouchActive: true
      });
    }
  }

  onStackScroll(event) {
    const element = event.currentTarget;
    const stackData = cornerstoneTools.getToolState(element, 'stack');
    const stack = stackData.data[0];
    const imageIndex = stack.currentImageIdIndex + 1;

    // TODO: put this on-screen somewhere?
    console.log(`Image: ${imageIndex}/${stack.imageIds.length}`);

    this.setState({
      stack
    });
  }

  onImageLoaded(event) {
    //console.log(event.detail);
    //const loadingProgress = $('#loading-progress');
    //this.numImagesLoaded += 1;
    //const imagesLeft = imageIds.length - numImagesLoaded;
    /*loadingProgress.text(`${imagesLeft} images requested`);
    if (numImagesLoaded === imageIds.length) {
      console.timeEnd('Loading All Images');
      loadingProgress.text('');
    }*/
  }

  startLoadingHandler() {
    clearTimeout(this.loadHandlerTimeout);
    this.loadHandlerTimeout = setTimeout(() => {
      this.isLoading = true;
    }, loadIndicatorDelay);
  }

  doneLoadingHandler() {
    clearTimeout(this.loadHandlerTimeout);
    this.isLoading = false;
  }

  onMeasurementAdded() {
    console.log('onMeasurementAdded');
    // TODO: Allow this to be set by props,
    // call enforceSingleMeasurement for standard cases
    // Allow this to be set on a case level
  }
}

export default CornerstoneViewport;
