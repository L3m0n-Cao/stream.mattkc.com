var emotes = [];
var token = null;
var authType = null;
var activeUsers = [];

var socket = null;

var statusTimeout = null;
const MAX_CHAT_LENGTH = 500;

var preventClosingUserConfig = false;
var userConf = null;
var userConfCallback = null;

var authLevel = 0;

var chatHistory = [];
var chatHistoryIndex = -1;
var chatHistoryStashed = '';

var mentionChecker = null;

var lastMessageReceived = -1;

var rulesAgreed = false;

var replyMessage = 0;

var emoji = new EmojiConvertor();
emoji.replace_mode = 'unified';
emoji.allow_native = true;

var hoveredEmote = null;

var chatDelay = 0;

const SCROLL_EPSILON = 16;

function GetQueryParameters() {
  var p = {};
  var queryParams = window.location.search.substring(1).split('&');
  for (var i = 0; i < queryParams.length; i++) {
    var kv = queryParams[i].split('=');
    if (kv.length == 2) {
      p[kv[0].trim().toLowerCase()] = kv[1].trim().toLowerCase();
    }
  }
  return p;
}

var params = GetQueryParameters();
if (params['delay'] != null) {
  chatDelay = parseInt(params['delay']);
}

function AddWordToTextarea(word) {
  var a = $("#sendMsgArea");
  var txt = a.val();
  if (txt.length > 0 && !txt.endsWith(' ')) {
    txt += ' ';
  }

  a.val(txt + word + ' ');

  a.focus();
}

function TimestampToString(timestamp) {
  if (timestamp == Number.MAX_SAFE_INTEGER) {
    return 'forever';
  } else {
    return new Date(timestamp * 1000).toLocaleString();
  }
}

function AuthorClick() {
  AddWordToTextarea('@' + $(this).html());
  $("#sendMsgArea").focus();
}

function MentionClick(sender) {
  AddWordToTextarea($(sender).html());
  $("#sendMsgArea").focus();
}

function EmoteZoomLoad(img) {
  if (hoveredEmote != null) {
    var panel = $(".emoteZoom");
    var btnOffset = hoveredEmote.offset();
    panel.show();
    panel.offset({top: btnOffset.top - panel.outerHeight(), left: btnOffset.left + hoveredEmote.outerWidth()/2 - panel.outerWidth()/2});
  }
}

function ShowEmoteZoom(v) {
  hoveredEmote = $(v);
  $("#emoteZoomImg").attr('src', hoveredEmote.attr('src'));
  $("#emoteZoomText").html(hoveredEmote.attr('alt'));
}

function HideEmoteZoom() {
  hoveredEmote = null;
  $(".emoteZoom").hide();
}

function GenerateEmoteImage(e) {
  return "<img alt='" + e.code + "' title='" + e.code + "' class='emote' onmouseenter='ShowEmoteZoom(this)' onmouseleave='HideEmoteZoom()' src='" + e.filename + "'>"
}

function UsernameCharIsValid(char) {
  return (char >= 0x30 && char <= 0x39)   // Numbers 0-9
      || (char >= 0x41 && char <= 0x5A)   // Uppercase A-Z
      || (char >= 0x61 && char <= 0x7A)   // Lowercase a-z
      || char == 0x5F;                    // Underscore
}

function IsValidEmoteChar(char) {
  return UsernameCharIsValid(char)
      || char == 0x3A   // :
      || char == 0x3B   // ;
      || char == 0x2D   // -
      || char == 0x21   // !
      || char == 0x3F   // ?
      || char == 0x7C;  // |
}

function CreateMsgBtn(img, hint) {
  var b = $("<div>");
  b.addClass('button');
  b.addClass('msgBtn');
  b.html('<img title="' + hint + '" alt="' + hint + '" src="' + img + '">');
  return b;
}

function SetReply(msgId) {
  UnsetReply();

  var panel = $("#replyPanel");

  var closeBtn = CreateMsgBtn("cross.svg", "Don't Reply");
  closeBtn.css('float', 'right');
  closeBtn.css('vertical-align', 'top');
  panel.append(closeBtn);
  closeBtn.click(UnsetReply);

  replyMessage = msgId;
  panel.append(CreateReplyPreview(replyMessage));

  panel.show();

  $("#sendMsgArea").focus();
}

function UnsetReply() {
  var panel = $("#replyPanel");
  replyMessage = 0;
  panel.hide();
  panel.empty();
}

function CreateReplyPreview(replyId) {
  var replySection = $("<div>");
  replySection.addClass("reply");

  var replyText = "an old message";
  var replyMessage = $(".messages div[data-message-id='" + replyId + "']");
  if (replyMessage.length != 0) {
    var cloned = replyMessage.clone();
    cloned.children('.msgBtns').remove();
    cloned.children('.reply').remove();
    replyText = cloned.contents();
  }

  replySection.html("<img src='reply.svg'> Reply to ");
  replySection.append(replyText);
  return replySection;
}

function ReceiveMessage(ath, athId, athCol, athLevel, msg, msgId, replyId, donateValue) {
  // Detect auto scroll fail condition
  var scroller = $(".messages-wrapper");
  if (scroller.scrollTop() > -SCROLL_EPSILON && scroller.scrollTop() < 0) {
    console.log("detected fail condition");
    $(".messages-wrapper").scrollTop(0);
  }

  var newMsg = $("<div>");
  newMsg.addClass('message');
  newMsg.attr('data-message-id', msgId);
  newMsg.attr('data-author', ath);

  if (chatDelay > 0) {
    newMsg.hide();
    setTimeout(function(){
      newMsg.show();
    }, chatDelay * 1000);
  }

  var msgBtns = $("<div>");
  msgBtns.addClass('msgBtns');

  var replyBtn = CreateMsgBtn("reply.svg", "Reply to Message");
  replyBtn.addClass('replyBtn');
  replyBtn.click(function(){
    var msg = $(this).closest(".message");
    SetReply(msg.data("message-id"));
  });
  msgBtns.append(replyBtn);

  var banBtn = CreateMsgBtn("exclam.svg", "Ban User");
  banBtn.addClass('banBtn');
  banBtn.click(function(){
    var username = $(this).closest(".message").data("author");
    if (confirm('Are you sure you want to ban ' + username + '?')) {
      SendSocketMessage('message', {
        text: '!ban ' + username,
      });
    }
  });
  msgBtns.append(banBtn);

  var delBtn = CreateMsgBtn("cross.svg", "Delete Message");
  delBtn.addClass('delBtn');
  delBtn.click(function(){
    var msg = $(this).closest(".message");
    var id = msg.data("message-id");

    var author = msg.children(".author");
    var txt = msg.children(".msgTxt");

    if (confirm('Are you sure you want to remove the message "' + txt.text() + '" from @' + author.text() + '?')) {
      SendSocketMessage('message', {
        text: '!rm ' + id,
      });
    }
  });
  msgBtns.append(delBtn);

  newMsg.append(msgBtns);

  // Determine if message was a reply to another
  if (replyId != 0) {
    var prev = CreateReplyPreview(replyId);
    var v = $(".messages div[data-message-id='" + replyId + "']");

    // Limit to one single line to prevent clogging up the chat
    prev.css({
      'max-height': '1.2em',
      'overflow': 'hidden'
    });

    // If the message is still on screen, allow clicking it to jump to it
    if (v.length != 0) {
      prev.css({
        'cursor': 'pointer'
      });
      prev.click(function(){
        var scroller = $(".messages-wrapper");
        scroller.scrollTop(scroller.scrollTop() + (v.offset().top - scroller.offset().top) + (v.outerHeight()/2) - (scroller.innerHeight()/2));

        const HIGHLIGHT_INTERVAL = 150;
        const HIGHLIGHT_COLOR = '#808040';
        v.css({'background': HIGHLIGHT_COLOR});
        setTimeout(function(){v.css({'background': ''});}, HIGHLIGHT_INTERVAL*1);
        setTimeout(function(){v.css({'background': HIGHLIGHT_COLOR});}, HIGHLIGHT_INTERVAL*2);
        setTimeout(function(){v.css({'background': ''});}, HIGHLIGHT_INTERVAL*3);
        setTimeout(function(){v.css({'background': HIGHLIGHT_COLOR});}, HIGHLIGHT_INTERVAL*4);
        setTimeout(function(){v.css({'background': ''});}, HIGHLIGHT_INTERVAL*5);
      });
    }
    newMsg.append(prev);
  }

  if (athLevel >= 50) {
    var badge = $("<img>");
    badge.addClass('badge');
    badge.attr('title', 'Moderator');
    badge.attr('alt', 'Moderator');
    badge.attr('src', 'mod.svg');
    newMsg.append(badge);
  }

  var author = $("<span>")
  author.addClass('author');
  author.html(ath);
  author.click(AuthorClick);
  author.css('color', '#' + athCol);
  newMsg.append(author);

  if (donateValue != '' && donateValue != null) {
    newMsg.append('<b> donated $' + donateValue + '</b>');
    newMsg.addClass('donateMsg');
  }

  // Parse URLs
  msg = msg.replace(/(https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*))/g, '<a href="$1" target="_blank">$1</a>');

  // Parse mentions
  if (userConf != null) {
    if (msg.toLowerCase().includes('@' + userConf.name.toLowerCase())) {
      newMsg.addClass('mention');
    }
  }
  msg = msg.replace(/((^|\s)@[A-Za-z0-9_]+)/g, '<span class="author" onclick="MentionClick(this)">$1</span>');

  // Parse colon emoji
  msg = emoji.replace_colons(msg);

  // Parse emotes
  for (var i = 0; i < emotes.length; i++) {
    var e = emotes[i];

    var indexOf = 0;
    while (true) {
      indexOf = msg.indexOf(e.code, indexOf);
      if (indexOf == -1) {
        break;
      }

      if ((indexOf > 0 && IsValidEmoteChar(msg.charCodeAt(indexOf-1)))
        || (indexOf < msg.length-e.code.length && IsValidEmoteChar(msg.charCodeAt(indexOf+e.code.length)))) {
        indexOf += e.code.length;
        continue;
      }

      var emoteMsg = msg.substring(0, indexOf);
      emoteMsg += GenerateEmoteImage(e);
      var newIndexOf = emoteMsg.length;
      emoteMsg += msg.substring(indexOf + e.code.length);
      msg = emoteMsg;
      indexOf = newIndexOf;
    }
  }

  if (msg != '' && msg != null) {
    var colon = $("<span>");
    colon.html(": ");
    newMsg.append(colon);

    var msgText = $("<span>");
    msgText.addClass("msgTxt");
    msgText.html(msg);
    newMsg.append(msgText);
  }

  newMsg.mouseenter(function(){
    var btns = $(this).children(".msgBtns");
    if (authLevel >= 50) {
      btns.children(".banBtn").show();
      btns.children(".delBtn").show();
    } else {
      btns.children(".banBtn").hide();
      btns.children(".delBtn").hide();
    }
    btns.show();
  }).mouseleave(function(){
    $(this).children(".msgBtns").hide();
  });

  var msgs = $(".messages");
  msgs.append(newMsg);

  const MAX_CHAT_ON_SCREEN = 100;
  while (msgs.children().length > MAX_CHAT_ON_SCREEN) {
    msgs.find('div:first').remove();
  }

  lastMessageReceived = msgId;
}

function ShowStatus(text, persistent) {
  if (statusTimeout != null) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }
  var status = $(".status");
  status.show();
  status.html(text);

  $(".timestamp").each(function(){
    var me = $(this);
    me.html(TimestampToString(me.html()));
  });

  if (!persistent) {
    statusTimeout = setTimeout(HideStatus, 5000);
  }
}

function HideStatus() {
  if (statusTimeout != null) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }
  $(".status").hide();
}

function ClearMentionChecker() {
  if (mentionChecker != null) {
    clearTimeout(mentionChecker);
    mentionChecker = null;
  }
}

function HideEmojiKeyboard() {
  $("#emoteKeyboard").hide();
}

function HideMentionList() {
  var mentionList = $("#mentionList");
  mentionList.hide();
  mentionList.empty();
  ClearMentionChecker();
}

function SendSocketMessage(type, data, ignore_empty_token = false) {
  if (socket != null && socket.readyState == 1 && (ignore_empty_token || (token != null && authType != null))) {
    socket.send(JSON.stringify({type: type, data: data, auth: authType, token: token}));
  }
}

function SendMessage() {
  var textarea = $("#sendMsgArea");
  var val = textarea.val().trim();
  HideStatus();
  if (val.length > MAX_CHAT_LENGTH) {
    ShowStatus('Your message is too long, it must be under ' + MAX_CHAT_LENGTH + ' characters');
  } else if (val != '') {
    SendSocketMessage('message', {
      text: val,
      reply: replyMessage
    });
  }
}

function OpenJoin() {
  window.open('https://www.youtube.com/mattkc/join');
}

function CheckUserStatus() {
  SendSocketMessage('status', {}, true);
}

function ShowUserConfError(error) {
  var uce = $("#userConfError");
  uce.html(error);
  uce.show();
}

function ReconnectChat() {
  ShowStatus("Connecting to chat...", true);

  socket = new WebSocket(CHAT_SERVER_ADDRESS);
  socket.addEventListener('open', (event) => {
    activeUsers = [];
    SendSocketMessage('hello', {last_message: lastMessageReceived}, true);
    HideStatus();
    CheckUserStatus();
  });
  socket.addEventListener('message', (event) => {
    var pkt = JSON.parse(event.data);

    if (pkt.type == 'chat') {
      ReceiveMessage(pkt.data.author, pkt.data.author_id, pkt.data.author_color, pkt.data.author_level, pkt.data.message, pkt.data.id, pkt.data.reply, pkt.data.donate_value);
    } else if (pkt.type == 'servermsg') {
      ShowStatus(pkt.data.message, false);
    } else if (pkt.type == "status") {
      if (pkt.data.status == 'unauthenticated') {
        token = null;
        authType = null;
        $("#loginButtons").show();
        $("#chatEntry").hide();
        $("#banNotice").hide();
        CloseShade();
      } else if (pkt.data.status == 'authenticated') {
        $("#loginButtons").hide();
        $("#chatEntry").show();
        $("#banNotice").hide();

        if (userConf == null) {
          UpdateLocalUserConfig();
        }
      } else if (pkt.data.status == 'banned') {
        $("#loginButtons").hide();
        $("#chatEntry").hide();
        $("#banNotice").show();
      } else if (pkt.data.status == 'rename') {
        if ($("#configPanel").is(":hidden")) {
          OpenUserConfig();
          $("#userConfCancelBtn").hide();
          preventClosingUserConfig = true;
        }
      } else if (pkt.data.status == 'nameexists') {
        ShowUserConfError('User with display name already exists. Please choose a different one.');
      } else if (pkt.data.status == 'nametimeout') {
        ShowUserConfError('Display name has been changed too recently. You can only change your display name once every 30 days.');
      } else if (pkt.data.status == 'nameinvalid') {
        ShowUserConfError('Display name contains an invalid character. Only A-Z, a-z, 0-9, and _ are valid.');
      } else if (pkt.data.status == 'namelength') {
        ShowUserConfError('Display name must be between 5-32 characters in length.');
      } else if (pkt.data.status == 'setuserconf') {
        preventClosingUserConfig = false;
        $("#userConfCancelBtn").show();
        CloseShade();
        CheckUserStatus();
        UpdateLocalUserConfig();
      }
    } else if (pkt.type == 'accepted') {
      var msgArea = $("#sendMsgArea");
      chatHistory.push(msgArea.val());
      chatHistoryIndex = -1;
      UnsetReply();
      if (pkt.data.message == msgArea.val().trim()) {
        msgArea.val('');
        HideEmojiKeyboard();
        HideMentionList();
      }
    } else if (pkt.type == 'join') {
      activeUsers.push(pkt.data.name);
      UpdateUserList();
    } else if (pkt.type == 'part') {
      activeUsers.splice(activeUsers.indexOf(pkt.data.name), 1);
      UpdateUserList();
    } else if (pkt.type == 'getuserconf') {
      userConf = pkt.data;
    } else if (pkt.type == 'delete') {
      for (var i = 0; i < pkt.data.messages.length; i++) {
        var msg = pkt.data.messages[i];
        $(".messages div[data-message-id='" + msg + "']").remove();
      }
    } else if (pkt.type == 'authlevel') {
      authLevel = pkt.data.value;
    }
  });
  socket.addEventListener('close', (event) => {
    if ($(".status").is(":hidden")) {
      ShowStatus("Lost connection from chat, retrying...", true);
    }
    setTimeout(ReconnectChat, 5000);
  });
}

function UpdateUserList() {
  var list = $("#usersSection");
  list.empty();

  var count = $("<div>");
  count.css('text-align', 'center');
  count.css('font-weight', 'bold');
  count.html("Users (" + activeUsers.length + ")");
  list.append(count);

  for (var i = 0; i < activeUsers.length; i++) {
    var ue = $("<div>");
    ue.addClass('author');
    ue.html(activeUsers[i]);
    list.append(ue);
  }
}

function CheckIfCursorIsInsideMention() {
  var textarea = $("#sendMsgArea");
  var cursorPos = textarea.prop("selectionStart");
  var str = textarea.val();

  // See if the cursor is inside a mention by looking backwards for valid username characters preceded by an @ symbol
  var found_at = -1;
  for (var i = cursorPos - 1; i >= 0; i--) {
    if (str.charCodeAt(i) == 0x40) {
      found_at = i;
      break;
    } else if (!UsernameCharIsValid(str.charCodeAt(i))) {
      break;
    }
  }

  // Ignore @ if not preceded by a space or at the start of the string
  if (found_at != 0 && str.charCodeAt(found_at-1) != 0x20) {
    found_at = -1;
  }

  var mentionList = $("#mentionList");

  if (found_at != -1) {
    var hint = str.substring(found_at+1, cursorPos);

    mentionList.show();
    mentionList.empty();

    const MAX_MENTION_LENGTH = 5;
    var elementCount = 0;

    for (var i = 0; i < activeUsers.length; i++) {
      if (activeUsers[i].toLowerCase().startsWith(hint.toLowerCase())) {
        var entry = $("<div>");
        entry.addClass('mentionListEntry');
        if (elementCount == 0) {
          entry.addClass('mentionListEntrySelected');
        }
        entry.html(activeUsers[i]);
        entry.on('mouseover', function(){
          $(".mentionListEntry").each(function(){
            $(this).removeClass('mentionListEntrySelected');
          });
          $(this).addClass('mentionListEntrySelected');
        });
        entry.on('click', function(){
          var textarea = $("#sendMsgArea");
          var cursorPos = textarea.prop("selectionStart");
          var str = textarea.val();
          var newStr = str.substring(0, found_at) + '@' + $(this).html() + ' ';
          var newCursor = newStr.length;
          newStr += str.substring(cursorPos);
          textarea.val(newStr);
          mentionList.hide();
          textarea.focus();
          textarea[0].setSelectionRange(newCursor, newCursor);
        });
        mentionList.append(entry);
        elementCount++;
      }

      if (elementCount == MAX_MENTION_LENGTH) {
        break;
      }
    }

    if (elementCount == 0) {
      var entry = $("<div>");
      entry.addClass('mentionListEntry');
      entry.html('<i>No matches</i>');
      mentionList.append(entry);
    }

    mentionList.outerWidth(textarea.outerWidth());

    var textareaPos = textarea.offset();
    mentionList.offset({top: textareaPos.top - mentionList.height(), left: textareaPos.left});
  } else {
    mentionList.hide();
  }
}

function LoadTokensFromCookies() {
  var cookies = GetCookies();
  token = cookies['auth'];
  authType = cookies['auth_type'];
  CheckUserStatus();
}

$(document).ready(function(){
  // Check login status
  LoadTokensFromCookies();

  // Read emote data from server
  $.get("emotes", function(data){
    emotes = data.split('\n');

    var emoteKeyboard = $("#emoteKeyboard");
    $(".popup").click(function(e){
      e.stopPropagation();
    });
    $(".panel").click(function(e){
      e.stopPropagation();
    });
    $("#emoteBtn").click(function(e){
      e.stopPropagation();
    });
    for (var i = 0; i < emotes.length; i++) {
      var e = emotes[i].split('\t');
      emotes[i] = {code: e[0], filename: e[1]};

      var btn = $("<div>");
      btn.addClass('emoteKeyboardButton');
      var img = $(GenerateEmoteImage(emotes[i]))
      btn.append(img);
      btn.data('emote', img.attr('title'));
      btn.click(function(){
        AddWordToTextarea($(this).data('emote'));
      });

      emoteKeyboard.append(btn);
    }
  });

  $(window).resize(function(){
    RepositionEmoteKeyboard();
  });

  $(document).click(function(){
    HideEmojiKeyboard();
    HideMentionList();
  });

  $(".messages-wrapper").scroll(function(){
    var notice = $("#scrollNotice");
    if ($(this).scrollTop() <= -SCROLL_EPSILON) {
      notice.show();
    } else {
      notice.hide();
    }
  });

  const MIN_DONATION = 2.00;
  var donateField = $("#donateAmount");
  donateField.attr("min", MIN_DONATION);
  donateField.attr("value", MIN_DONATION.toFixed(2));
  $("#donateAmount").change(function() {
    var d = parseFloat($(this).val());
    var de = $("#donateError");
    if (d < MIN_DONATION) {
      de.html("Amounts less than " + MIN_DONATION.toFixed(2) + " will not display");
      de.show();
    } else {
      de.hide();
    }
    $(this).val(d.toFixed(2));
  });

  // Catch "enter" events from textarea
  var textarea = $("#sendMsgArea");
  textarea.on('keydown', function(e){
    const KEY_TAB = 9;
    const KEY_ENTER = 13;
    const KEY_ESC = 27;
    const KEY_UP = 38;
    const KEY_DOWN = 40;

    HideEmojiKeyboard();
    if (e.keyCode == KEY_TAB) {
      if ($("#mentionList").is(":visible")) {
        $(".mentionListEntrySelected").click();
        e.preventDefault();
      }
    } else if (e.keyCode == KEY_ESC) {
      UnsetReply();
    } else if (e.keyCode == KEY_ENTER && !e.shiftKey) { // Enter/return key
      e.preventDefault();
      if ($("#mentionList").is(":visible")) {
        $(".mentionListEntrySelected").click();
      } else {
        SendMessage();
      }
    } else if (e.keyCode == KEY_UP || e.keyCode == KEY_DOWN) {
      if ($("#mentionList").is(":visible")) {
        // Move up and down mention list
        var adjacent = null;
        if (e.keyCode == KEY_UP) { // Up arrow
          adjacent = $(".mentionListEntrySelected").prev()[0];
        } else {
          adjacent = $(".mentionListEntrySelected").next()[0];
        }
        if (adjacent != null) {
          $(".mentionListEntrySelected").removeClass('mentionListEntrySelected');
          $(adjacent).addClass('mentionListEntrySelected')
        }
        e.preventDefault();
      } else {
        // Jump up and down through chat history recall
        var msgArea = $(this);
        var cursorPos = msgArea.prop("selectionStart");
        if (e.keyCode == KEY_UP) { // Up arrow
          if (cursorPos == 0 && chatHistoryIndex < chatHistory.length-1) {
            if (chatHistoryIndex == -1) {
              chatHistoryStashed = msgArea.val();
            }
            chatHistoryIndex++;
            msgArea.val(chatHistory[chatHistory.length-1-chatHistoryIndex]);
            e.preventDefault();
          }
        } else if (e.keyCode == KEY_DOWN) { // Down arrow
          if (cursorPos == msgArea.val().length && chatHistoryIndex >= 0) {
            chatHistoryIndex--;
            if (chatHistoryIndex == -1) {
              msgArea.val(chatHistoryStashed);
            } else {
              msgArea.val(chatHistory[chatHistory.length-1-chatHistoryIndex]);
            }
            e.preventDefault();
          }
        }
      }
    } else {
      ClearMentionChecker();
      mentionChecker = setTimeout(CheckIfCursorIsInsideMention, 100)
    }
  });
  textarea.on('focus', function(){
    var cookies = GetCookies();
    if (cookies['rules'] != '1' && !rulesAgreed) {
      var rulesPanel = $(".rules");
      rulesPanel.outerWidth(textarea.outerWidth());
      rulesPanel.offset({left: textarea.offset().left, top: textarea.offset().top + textarea.outerHeight() - rulesPanel.outerHeight()});
      rulesPanel.show();
      textarea.blur();
    }
  });

  // Hide pop-out button if not embedded in iframe
  if (window.self === window.top) {
    $("#popoutBtn").hide();
  }

  // Attempt chat server connection
  ReconnectChat();

  // Set timer for status checking
  setInterval(CheckUserStatus, 10000);
});

function RulesAgreed() {
  document.cookie = 'rules=1';
  rulesAgreed = true;
  $(".rules").hide();
  $("#sendMsgArea").focus();
}

function RepositionEmoteKeyboard() {
  var emoteKeyboard = $("#emoteKeyboard");
  var emoteBtn = $("#emoteBtn");
  var emoteBtnPos = emoteBtn.offset();
  var x = Math.max(emoteBtnPos.left - emoteKeyboard.outerWidth() + emoteBtn.outerWidth(), 0);
  emoteKeyboard.offset({left: x, top: emoteBtnPos.top - emoteKeyboard.outerHeight()});
}

function ToggleEmoteKeyboard() {
  var emoteKeyboard = $("#emoteKeyboard");
  if (emoteKeyboard.is(":hidden")) {
    emoteKeyboard.show();
    RepositionEmoteKeyboard();
  } else {
    emoteKeyboard.hide();
  }
}

function UpdateLocalUserConfig() {
  SendSocketMessage('getuserconf');
}

function OpenUserConfig() {
  if (userConf != null) {
    $("#displayNameEntry").val(userConf.name);
    $("#displayColorEntry")[0].jscolor.fromString('#' + userConf.color);
  }
  $("#userConfError").hide();
  $("#shade").css('display', 'flex');
  $("#configPanel").show();
  /* Still working on this...
  if (('Notification' in window) && ('serviceWorker' in navigator) && ('PushManager' in window)) {
    $('#notifRow').show();
  }*/
}

function CloseShade() {
  if (!preventClosingUserConfig) {
    $("#shade").hide();
    $("#configPanel").hide();
    $("#userConfError").hide();
    $("#donatePanel").hide();
  }
}

function SaveUserConfig() {
  SendSocketMessage('setuserconf', {
    name: $("#displayNameEntry").val(),
    color: $("#displayColorEntry").val().replace('#', '')
  });
}

function Donate() {
  $("#shade").css('display', 'flex');
  $("#donateMessage").val('');
  $("#donatePanel").show();
}

function ToggleUserList() {
  $("#usersSection").toggle();
  $("#messagesSection").toggle();
}

function EnableNotifications() {
  var notif = Notification.requestPermission().then(function(permission) {
    if (permission === "granted") {
      const notification = new Notification('You will now be notified the next time a stream goes live.', {
        icon: '/favicon.png'
      });
    }
  });
}

function JumpScrollToBottom() {
  $(".messages-wrapper").scrollTop(0);
}
