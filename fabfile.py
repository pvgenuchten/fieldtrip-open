from email.mime.text import MIMEText

from fabric.api import cd, env, execute, hosts, lcd, local, put, run, settings
from fabric.contrib.files import exists
from fabric.contrib.project import rsync_project

import xml.etree.ElementTree as ET

import codecs
import ConfigParser
import json
import os
import smtplib
import re, itertools


CORDOVA_VERSION   = '3.2.0-0.4.0'
OPENLAYERS_VERSION = '2.12'
PROJ4JS_VERSION    = '1.1.0'

config = None


def install_project(platforms='android', dist_dir='apps', target='local'):
    """
    Install Cordova runtime

    platforms - list of supported platforms seperated by a space
    dist_dir - directory for unpacking openlayers
    target - runtime root
    """

    if 'android' in platforms:
        _check_command('android')
    _check_command('cordova')

    proj_home, src_dir, app_dir = _get_source()

    # get config file
    _check_config()

    target_dir, runtime = _get_runtime(target)

    js_dir = os.sep.join(('www', 'js', 'ext'))
    css_dir = os.sep.join(('www', 'css', 'ext'))

    def _install_plugins(names):
        for name in names:
            local('cordova plugin add https://git-wip-us.apache.org/repos/asf/{0}'.format(name))

    def _read_data(fil):
        with open(fil, 'r') as f:
            filedata = f.read()
            f.close()
            return filedata
        return None

    def _write_data(fil, filedata):
        f = open(fil, 'w')
        f.write(filedata)
        f.close()

    def _settings_options(filedata, _urls, _names, place):
        urls = _config(_urls).split(",")
        names = _config(_names).split(",")
        options = []
        for name, url in itertools.izip(names, urls):
            options.append('<option value="{0}">{1}</option>'.format(url, name))
        return filedata.replace(place, "\n\t\t".join(options))

    #create config.xml
    filedata = _read_data(os.sep.join(('etc', 'config.xml')))
    filedata = filedata.replace('{{name}}', _config('name'))
    filedata = filedata.replace('{{version}}', _config('version'))
    filedata = filedata.replace('{{version_code}}', _config('version').replace(".", ""))
    filedata = filedata.replace('{{author_email}}', _config('author_email'))
    filedata = filedata.replace('{{url}}', _config('url'))
    access_urls = _config('access_urls').split(",")
    access = []
    for url in access_urls:
        access.append('<access origin="{0}" />'.format(url))
    filedata = filedata.replace('{{access_urls}}', "\n".join(access))

    _write_data(os.sep.join((src_dir, 'assets', 'www', 'config.xml')), filedata)

    #create settings.html
    filedata = _read_data(os.sep.join(('etc', 'settings.html')))

    filedata = _settings_options(filedata, 'mapserver_urls', 'mapserver_names', '{{mapserver_urls}}')
    filedata = _settings_options(filedata, 'pcapi_urls', 'pcapi_names', '{{pcapi_urls}}')

    _write_data(os.sep.join((src_dir, 'assets', 'www', 'settings.html')), filedata)

    if os.path.exists(runtime):
        # check if they want to delete existing installation
        msg = 'Directory {0} exists.\nDo you wish to delete it(Y/n)? > '.format(runtime)
        answer = raw_input(msg).strip()

        if len(answer) > 0 and answer != 'y':
            print 'Choosing not continue. Nothing installed.'
            return

        local('rm -rf {0}'.format(runtime))
    else:
        os.mkdir(runtime)

    # install external js libraries
    local('bower install')
    bower = json.loads(open('bower.json').read())
    bower_home = os.sep.join((proj_home, 'bower_components'))

    # install cordova
    with lcd(target_dir):
        local('cordova create {0} {1} {1}'.format(
            runtime,
            _config('package'),
            _config('name')))

    # add project specific files
    update_app(app_dir, runtime)

    with lcd(runtime):

        # add platforms and plugins
        local('cordova platform add {0}'.format(platforms))
        _install_plugins([
            'cordova-plugin-device.git',
            'cordova-plugin-network-information',
            'cordova-plugin-geolocation.git',
            'cordova-plugin-camera.git',
            'cordova-plugin-media-capture.git',
            'cordova-plugin-media.git',
            'cordova-plugin-file.git',
            'cordova-plugin-file-transfer.git',
            'cordova-plugin-inappbrowser.git',
            'cordova-plugin-console.git'])

        # create sym link to assets
        local('rm -rf www')
        asset_dir =  os.sep.join((src_dir, 'assets', 'www'))
        local('ln -s %s' % asset_dir)

        # install js/css dependencies
        local('rm -f {0}/*'.format(js_dir))
        local('rm -f {0}/*'.format(css_dir))
        for dep in bower['dependency_locations']:
            files = bower['dependency_locations'][dep]
            version = bower['dependencies'][dep]
            for f in files:
                f = f.replace('x.x', version)
                src = os.sep.join((bower_home, dep, f))
                f_name = dep.replace('-bower', '')
                if f[len(f) - 2:] == 'js':
                    dest = os.sep.join((js_dir, '{0}.js'.format(f_name)))
                else:
                    dest = os.sep.join((css_dir, '{0}.css'.format(f_name)))
                local('cp {0} {1}'.format(src, dest))

    # check if /home/<user>/<dist_dir> exists
    dist_path = os.sep.join((os.environ['HOME'], dist_dir))
    if not os.path.exists(dist_path):
        os.makedirs(dist_path)

    # install proj4js
    proj4js_path = os.sep.join((dist_path, 'proj4js'))
    if not os.path.exists(proj4js_path):
        with lcd(dist_path):
            local('wget http://download.osgeo.org/proj4js/proj4js-{0}.zip'.format(PROJ4JS_VERSION))
            local('unzip proj4js-{0}.zip'.format(PROJ4JS_VERSION))

    with lcd(runtime):
        # copy it to ext folder
        local('cp {0} {1}'.format(os.sep.join((proj4js_path, 'lib', 'proj4js-compressed.js')),
                                  os.sep.join((js_dir, 'proj4js.js'))))

    # check if openlayers is installed
    ol_dir = 'OpenLayers-%s' % OPENLAYERS_VERSION
    ol_path = os.sep.join((dist_path, ol_dir))

    if not os.path.exists(ol_path):
        # install openlayers
        with lcd(dist_path):
            ol_tar_file_name = '%s.tar.gz' % ol_dir
            ol_tar = 'http://openlayers.org/download/%s' % ol_tar_file_name
            local('wget %s' % ol_tar)
            local('tar xvfz %s' % ol_tar_file_name)

    with lcd(os.sep.join((ol_path, 'build'))):
        cfg_file = os.sep.join((src_dir, 'etc', 'openlayers-mobile.cfg'))
        js_mobile = os.sep.join((runtime, js_dir, 'openlayers.js'))
        local('./build.py %s %s' % (cfg_file, js_mobile))


def deploy_android():
    """
    Deploy android to device connected to machine
    """

    _check_command('ant')
    _check_command('adb')
    _check_command('cordova')
    _check_command('android')

    with lcd(_get_runtime()[1]):
        device = None
        local('cordova build')

        with settings(warn_only=True):
            cmd = 'cordova run android 2>&1'
            out = local(cmd, capture=True)

            if out and out.find('INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES') != -1:
                # app is installed with wrong certificate try and uninstall app
                local('adb uninstall {0}'.format(_config('package')))

                # retry install
                local(cmd)


def release_android(beta='True', overwrite='False', email=False):
    """
    Release version of field trip app

    beta - BETA release or LIVE?
    overwrite - should current apk file be overwitten?
    email - send email to ftgb mailing list?
    """

    proj_home, src_dir, app_dir = _get_source()
    _check_config()
    runtime = _get_runtime()[1];

    update_app(app_dir, runtime)

    # get app version
    tree = ET.parse(os.sep.join((runtime, 'platforms', 'android', 'AndroidManifest.xml')))
    namespace = "{http://schemas.android.com/apk/res/android}"
    root = tree.getroot()
    version = root.attrib['{0}versionName'.format(namespace)]

    # update utils.js with app version
    utils = os.sep.join((_get_source()[1], 'assets', 'www', 'js', 'utils.js'))
    f = open(utils, 'r')
    file_str = f.read()
    f.close()
    file_str = re.sub(r'version\': \'[0-9]\.[0-9]\..+',
                      "version': '{0}'".format(version),
                      file_str)
    f = open(utils, 'w')
    f.write(file_str)
    f.close()

    with lcd(runtime):
        bin_dir = os.sep.join((runtime, 'platforms', 'android', 'bin'))
        apk_name = _config('package').replace('.', '')

        # do the build
        if str2bool(beta):
            file_name = '{0}-debug.apk'.format(apk_name)
            new_file_name = '{0}-debug.apk'.format(_config('name'))
            local('cordova build')
        else:
            file_name = '{0}.apk'.format(apk_name)
            new_file_name = '{0}.apk'.format(_config('name'))
            with lcd(os.sep.join((runtime, 'platforms', 'android'))):
                local('ant clean release')

            # sign the application
            unsigned_apkfile = os.sep.join((bin_dir, '{0}-release-unsigned.apk'.format(apk_name)))
            #unsigned_apkfile = os.sep.join((bin_dir, '{0}-release-unaligned.apk'.format(name)))
            signed_apkfile = os.sep.join((bin_dir, '{0}-release-signed.apk'.format(apk_name)))
            local('cp {0} {1}'.format(unsigned_apkfile, signed_apkfile))
            keystore = _config('keystore', section='release')

            if keystore.find('@') != -1:
                # if keystore is stored remotely copy it locally
                ks_name = keystore[keystore.rfind('/') + 1: len(keystore)]
                keystore_local = os.sep.join((src_dir, 'etc', ks_name))
                local('scp {0} {1}'.format(keystore, keystore_local))
                keystore = keystore_local

            local('jarsigner -verbose -sigalg MD5withRSA -digestalg SHA1 -keystore {0} {1} {2}'.format(
                keystore,
                signed_apkfile,
                _config('name')))

            # align the apk file
            apkfile = os.sep.join((bin_dir, file_name))
            local('zipalign -v 4 {0} {1}'.format(signed_apkfile, apkfile))

    # copy apk to servers, if defined
    hosts = _config('hosts', section='release')
    env.hosts = _config('hosts', section='release').split(',')
    if len(env.hosts) > 0:
        execute('copy_apk_to_servers', version, file_name, new_file_name, str2bool(overwrite))

    # inform of release
    if email:
        _email(new_file_name, version, beta)


def update_app(app_dir=None, runtime=None):
    """Update app with latest configuration"""
    if not app_dir:
        app_dir = _get_source()[2]
    if not runtime:
        runtime = _get_runtime()[1]

    local('cp -rf %s/* %s ' % (app_dir, runtime))


def copy_apk_to_servers(version, file_name, new_file_name, overwrite):
    """
    Copy APK file to servers

    version - app version
    file_name - apk file name, as generated from build
    new_file_name - the new, user friendly, name for the apk file
    overwrite - should current apk file be overwitten?
    """

    runtime = _get_runtime()[1];
    apk = os.sep.join((runtime, 'platforms', 'android', 'bin', file_name))

    # copy to server
    target_dir = '{0}/{1}'.format(_config('dir', section='release'), version)
    if not exists(target_dir):
        run('mkdir {0}'.format(target_dir))

    target_file = os.sep.join((target_dir, file_name))
    if exists(target_file) and not overwrite:
        print '\nVersion {0} already exists at {1}'.format(version, target_file)
        print '*** Unable to release to {0} ***\n'.format(env.host_string)
    else:
        put(apk, os.sep.join((target_dir, new_file_name)))

def _check_command(cmd):
    """checks a command is in the path"""
    with settings(warn_only=True):
        out = local('command -v {0}'.format(cmd), capture=True)
        if out.return_code != 0:
            print '{0} needs to be installed and in your path'.format(cmd)
            exit(0)

    if cmd == 'cordova':
        version = local('cordova -v', capture=True).strip();
        if version != CORDOVA_VERSION:
            _check_command('npm')
            local('npm install -g cordova@{0}'.format(CORDOVA_VERSION))

def _check_config():
    """
    If config.ini exists update from remote location, otherwise prompt user for location
    """

    proj_home = _get_source()[0]
    conf_dir = os.sep.join((proj_home, 'etc'))
    conf_file = os.sep.join((conf_dir, 'config.ini'))
    if not os.path.exists(conf_file):
        msg = '\nProvide location of config file > '
        answer = raw_input(msg).strip()
        if len(answer) > 0:
            if answer.find('@') == -1:
                if os.path.exists(answer):
                    local('cp {0} {1}'.format(answer, conf_dir))
                else:
                    print "File not found, can't continue."
                    exit(0)
            else:
                local('scp {0} {1}'.format(answer, conf_dir))
    else:
        # pick up any changes
        location = _config('location')
        local('rsync -avz {0} {1}'.format(location, conf_dir))


def _config(var, section='install'):
    global config
    if config == None:
        config = ConfigParser.ConfigParser()
        conf_file = os.sep.join((_get_source()[0], 'etc', 'config.ini'))
        config.read(conf_file)

    return config.get(section, var)


def _email(file_name,
           version,
           beta='True',
           platform='Android'):

    url = _config('url', section='release')

    title = '{0} {1}'.format(platform, _config('name'))
    if str2bool(beta):
        title = '{0} beta release'.format(title)
        to = _config('email_beta', section='release')
    else:
        title = '{0} release'.format(title)
        to = _config('email_official', section='release')

    msg = MIMEText('{0}/{1}/{2}'.format(url, version, file_name))
    title = '{0} {1}'.format(title, version)
    sender = _config('sender', section='release')

    msg['Subject'] = title
    msg['From'] = sender
    msg['To'] = to

    s = smtplib.SMTP(_config('smtp', section='release'))
    s.sendmail(sender, [to], msg.as_string())
    s.quit()


def _get_runtime(target='local'):
    """
    Get fieldtrip runtime directories.
    Returns a tuple containing:

    0) the project runtime root
    1) application specific runtime.
    """

    runtime_dir = _config('runtime_dir')
    target_dir = os.sep.join((os.environ['HOME'], target))
    return target_dir, os.sep.join((target_dir, runtime_dir))


def _get_source(app='android'):
    """
    Get fieldtip source directories.
    Returns a tuple containing:

    0) project home
    1) directory containing source code
    2) platform specific code
    """

    proj_home = local('pwd', capture=True).strip();
    src_dir = os.sep.join((proj_home, 'src'))
    return proj_home, src_dir, os.sep.join((src_dir, app))


def str2bool(v):
    return v.lower() in ("yes", "true", "t", "1")
