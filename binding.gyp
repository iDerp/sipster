{
  'targets': [
    {
      'target_name': 'sipster',
      'sources': [
        'src/binding.cc',
        'src/SIPSTERAccount.cc',
        'src/SIPSTERCall.cc',
        'src/SIPSTERMedia.cc',
        'src/SIPSTERTransport.cc',
      ],
      'include_dirs': [
        "src",
        "<!(node -e \"require('nan')\")"
      ],
      'conditions': [
        [ 'OS!="win"', {
          'cflags_cc': [
            '<!@(pkg-config --atleast-version=2.4.5 libpjproject)',
            '<!@(pkg-config --cflags libpjproject)',
            '-fexceptions',
            '-Wno-maybe-uninitialized',
          ],
          'libraries': [
            '<!@(pkg-config --libs libpjproject)',
          ],
        }],
        [ 'OS=="mac"', {
          'xcode_settings': {
            'OTHER_CFLAGS': [
              '-fexceptions',
              '-frtti',
            ],
          },

          # begin gyp stupidity workaround =====================================
          'libraries!': [
            'AppKit',
          ],
          'libraries': [
            'AppKit.framework',
          ],
          # end gyp stupidity workaround =======================================

        }],
      ],
    },
  ],
}
