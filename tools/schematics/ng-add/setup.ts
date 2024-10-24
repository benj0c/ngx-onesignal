import * as ansiColors from 'ansi-colors';
import {
  chain,
  Rule,
  SchematicContext,
  Tree,
  apply,
  url,
  template,
  move,
  mergeWith,
  MergeStrategy,
} from '@angular-devkit/schematics';
import {
  addModuleImportToRootModule,
  getProjectFromWorkspace,
  getProjectMainFile,
  hasNgModuleImport,
  getProjectTargetOptions,
} from '@angular/cdk/schematics';
import { getWorkspace } from '@schematics/angular/utility/workspace';
import { getSourceNodes } from '@schematics/angular/utility/ast-utils';
import { getAppModulePath } from '@schematics/angular/utility/ng-ast-utils';
import { Schema as ngxOneSignalSchema } from './schema';
import { strings } from '@angular-devkit/core';
import { readIntoSourceFile } from '../util/file';
import { join } from 'path';
import ts = require('typescript');

export default function(options: ngxOneSignalSchema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    return chain([
      addNgxOnesignalModule(options),
      addOneSignalSDKWorkers(options),
      updateAngularJson(options),
      replaceServiceWorkerScript(options)
    ])(tree, context);
  };
}

// Create a separate instance to prevent unintended global changes to the color configuration
const colors = ansiColors.create();

function addNgxOnesignalModule(options: ngxOneSignalSchema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const MODULE_NAME = `NgxOneSignalModule.forRoot({ appId: '${options.appId}'}),`;
    getWorkspace(tree).then(workspace => {
      const project = getProjectFromWorkspace(workspace, options.project);
      const appModulePath = getAppModulePath(tree, getProjectMainFile(project));

      if (hasNgModuleImport(tree, appModulePath, MODULE_NAME)) {
        return console.warn(
          colors.red(
            `Could not import "NgxOneSignalModule" because "NgxOneSignalModule" is already imported.`,
          ),
        );
      }

      addModuleImportToRootModule(tree, MODULE_NAME, 'ngx-onesignal', project);
      context.logger.info('✅️ Import NgxOneSignalModule into root module');
      return tree;
    });
  };
}

function addOneSignalSDKWorkers(options: ngxOneSignalSchema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    getWorkspace(tree).then(workspace => {
      const templateSource = apply(url('./files'), [
        template({
          ...strings,
          ...options,
        }),
        move(getProjectFromWorkspace(workspace, options.project).sourceRoot)
      ]);

      return mergeWith(templateSource, MergeStrategy.Default)(tree, context);
    });
  };
}

function updateAngularJson(options: ngxOneSignalSchema): Rule {
  return (tree: Tree) => {
    getWorkspace(tree).then(workspace => {
      const project = getProjectFromWorkspace(workspace, options.project);
      const targetOptions = getProjectTargetOptions(project, 'build');

      const assets = Array.isArray(targetOptions.assets) ? targetOptions.assets : [];
      targetOptions.assets = [
        join(project.sourceRoot, 'OneSignalSDKWorker.js'),
        join(project.sourceRoot, 'OneSignalSDKUpdaterWorker.js'),
        ...assets
      ];

      tree.overwrite('angular.json', JSON.stringify(workspace, null, 2));

      return tree;
    });
  };
}


function replaceServiceWorkerScript(options: ngxOneSignalSchema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    getWorkspace(tree).then(workspace => {
      const project = getProjectFromWorkspace(workspace, options.project);
      const modulePath = getAppModulePath(tree, getProjectMainFile(project));

      if (!modulePath) {
        return context.logger.warn(
          `❌ Could not find environment file: "${modulePath}". Skipping firebase configuration.`
        );
      }

      const insertion = `'OneSignalSDKWorker.js'`;
      const sourceFile = readIntoSourceFile(tree, modulePath);

      const sourceFileText = sourceFile.getText();
      if (sourceFileText.includes(insertion)) {
        return;
      }

      const nodes = getSourceNodes(sourceFile as any);
      // tslint:disable-next-line:no-non-null-assertion
      const serviceWorkerScript = nodes.find(
        node => node.kind === ts.SyntaxKind.StringLiteral &&
          node.getText(sourceFile) === `'ngsw-worker.js'`
      );
      if ( typeof serviceWorkerScript === 'undefined') {
        context.logger.error(
          `❌ @angular/pwa will not be added, please execute the following command 'npx ng add @angular/pwa'`
        );
        throw Error('@angular/pwa will not be added');
      }
      const recorder = tree.beginUpdate(modulePath);
      recorder.remove(serviceWorkerScript.pos, serviceWorkerScript.getFullWidth());
      recorder.insertLeft(serviceWorkerScript.pos, insertion);
      tree.commitUpdate(recorder);

      context.logger.info('✅️ Environment configuration');
      return tree;
    });
  };
}
