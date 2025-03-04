/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import React, { Component } from "react";
import PropTypes from "prop-types";
import classnames from "classnames";
import { Tab, Tabs, TabList, TabPanels } from "react-aria-components/src/tabs";

import actions from "../../actions";
import {
  getProjectDirectoryRootName,
  getSelectedPrimaryPaneTab,
  getContext,
} from "../../selectors";
import { prefs } from "../../utils/prefs";
import { connect } from "../../utils/connect";
import { primaryPaneTabs } from "../../constants";
import { formatKeyShortcut } from "../../utils/text";

import Outline from "./Outline";
import SourcesTree from "./SourcesTree";
import ProjectSearch from "./ProjectSearch";
import AccessibleImage from "../shared/AccessibleImage";

import "./Sources.css";

const tabs = [
  primaryPaneTabs.SOURCES,
  primaryPaneTabs.OUTLINE,
  primaryPaneTabs.PROJECT_SEARCH,
];

class PrimaryPanes extends Component {
  constructor(props) {
    super(props);

    this.state = {
      alphabetizeOutline: prefs.alphabetizeOutline,
    };
  }

  static get propTypes() {
    return {
      clearProjectDirectoryRoot: PropTypes.func.isRequired,
      cx: PropTypes.object.isRequired,
      projectRootName: PropTypes.string.isRequired,
      selectedTab: PropTypes.oneOf(tabs).isRequired,
      setPrimaryPaneTab: PropTypes.func.isRequired,
      setActiveSearch: PropTypes.func.isRequired,
      closeActiveSearch: PropTypes.func.isRequired,
    };
  }

  onAlphabetizeClick = () => {
    const alphabetizeOutline = !prefs.alphabetizeOutline;
    prefs.alphabetizeOutline = alphabetizeOutline;
    this.setState({ alphabetizeOutline });
  };

  onActivateTab = index => {
    const tab = tabs.at(index);
    this.props.setPrimaryPaneTab(tab);
    if (tab == primaryPaneTabs.PROJECT_SEARCH) {
      this.props.setActiveSearch(tab);
    } else {
      this.props.closeActiveSearch();
    }
  };

  renderTabList() {
    return [
      <Tab
        className={classnames("tab sources-tab", {
          active: this.props.selectedTab === primaryPaneTabs.SOURCES,
        })}
        key="sources-tab"
      >
        {formatKeyShortcut(L10N.getStr("sources.header"))}
      </Tab>,
      <Tab
        className={classnames("tab outline-tab", {
          active: this.props.selectedTab === primaryPaneTabs.OUTLINE,
        })}
        key="outline-tab"
      >
        {formatKeyShortcut(L10N.getStr("outline.header"))}
      </Tab>,
      <Tab
        className={classnames("tab search-tab", {
          active: this.props.selectedTab === primaryPaneTabs.PROJECT_SEARCH,
        })}
        key="search-tab"
      >
        {formatKeyShortcut(L10N.getStr("search.header"))}
      </Tab>,
    ];
  }

  renderProjectRootHeader() {
    const { cx, projectRootName } = this.props;

    if (!projectRootName) {
      return null;
    }

    return (
      <div key="root" className="sources-clear-root-container">
        <button
          className="sources-clear-root"
          onClick={() => this.props.clearProjectDirectoryRoot(cx)}
          title={L10N.getStr("removeDirectoryRoot.label")}
        >
          <AccessibleImage className="home" />
          <AccessibleImage className="breadcrumb" />
          <span className="sources-clear-root-label">{projectRootName}</span>
        </button>
      </div>
    );
  }

  render() {
    const { selectedTab, projectRootName } = this.props;
    return (
      <Tabs
        activeIndex={tabs.indexOf(selectedTab)}
        className="sources-panel"
        onActivateTab={this.onActivateTab}
      >
        <TabList className="source-outline-tabs">
          {this.renderTabList()}
        </TabList>
        <TabPanels
          className={classnames("source-outline-panel", {
            "has-root": projectRootName,
          })}
          hasFocusableContent
        >
          <div className="threads-list">
            {this.renderProjectRootHeader()}
            <SourcesTree />
          </div>
          <Outline
            alphabetizeOutline={this.state.alphabetizeOutline}
            onAlphabetizeClick={this.onAlphabetizeClick}
          />
          <ProjectSearch />
        </TabPanels>
      </Tabs>
    );
  }
}

const mapStateToProps = state => {
  return {
    cx: getContext(state),
    selectedTab: getSelectedPrimaryPaneTab(state),
    projectRootName: getProjectDirectoryRootName(state),
  };
};

const connector = connect(mapStateToProps, {
  setPrimaryPaneTab: actions.setPrimaryPaneTab,
  setActiveSearch: actions.setActiveSearch,
  closeActiveSearch: actions.closeActiveSearch,
  clearProjectDirectoryRoot: actions.clearProjectDirectoryRoot,
});

export default connector(PrimaryPanes);
