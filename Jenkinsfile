// Jenkins pipeline for Horizon — runs the unit tests on every push / PR.
//
// Setup expectations (see CLAUDE.md / the setup notes):
//   - A "NodeJS" tool named 'node20' is configured in Jenkins
//     (Manage Jenkins → Tools → NodeJS installations), OR Node is already on
//     the agent PATH (then you can delete the `tools` block below).
//   - For PRs: use a Multibranch Pipeline job with the GitHub Branch Source
//     plugin pointed at this repo. It discovers branches + PRs and runs this file.

pipeline {
  agent any

  tools {
    nodejs 'node20'
  }

  options {
    timestamps()
    timeout(time: 15, unit: 'MINUTES')
    disableConcurrentBuilds()
  }

  stages {
    stage('Install') {
      steps {
        // npm ci = clean, lockfile-exact install. Cross-platform (bat on Windows).
        script {
          if (isUnix()) { sh 'npm ci' } else { bat 'npm ci' }
        }
      }
    }

    stage('Test') {
      steps {
        // writes junit.xml via the jest-junit reporter
        script {
          if (isUnix()) { sh 'npm run test:ci' } else { bat 'npm run test:ci' }
        }
      }
    }
  }

  post {
    always {
      // Publish test results so Jenkins shows pass/fail trends per build.
      junit testResults: 'junit.xml', allowEmptyResults: true
    }
    success {
      echo 'Horizon tests passed.'
    }
    failure {
      echo 'Horizon tests failed — see the Test Result for details.'
    }
  }
}
