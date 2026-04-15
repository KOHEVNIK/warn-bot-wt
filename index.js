const { Client, GatewayIntentBits, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, Collection } = require('discord.js');
const http = require('http');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Хранилища
const pendingSends = new Collection(); // Для /send
const events = new Collection();       // Для /event

// ========== ОЧИСТКА ПРОСРОЧЕННЫХ ВАРНОВ ==========
async function cleanExpiredWarns(guild) {
  const now = new Date();
  const warnRoles = guild.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));

  for (const role of warnRoles.values()) {
    const nameMatch = role.name.match(/⚠️ Warn \((\d{2}\.\d{2}\.\d{4})\) \[(\d+)д\]/);
    if (!nameMatch) continue;
    
    const dateStr = nameMatch[1];
    const durationDays = parseInt(nameMatch[2]);
    
    const [day, month, year] = dateStr.split('.');
    const issueDate = new Date(`${year}-${month}-${day}`);
    const expireDate = new Date(issueDate);
    expireDate.setDate(expireDate.getDate() + durationDays);
    
    if (now >= expireDate) {
      console.log(`🗑️ Удаляем просроченный варн: ${role.name}`);
      
      for (const member of role.members.values()) {
        await member.roles.remove(role).catch(() => {});
      }
      
      if (role.members.size === 0) {
        await role.delete().catch(() => {});
      }
    }
  }
}

// ========== СНЯТИЕ ВСЕХ ВАРНОВ С ПОЛЬЗОВАТЕЛЯ ==========
async function removeAllWarns(member) {
  const warnRoles = member.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
  
  for (const role of warnRoles.values()) {
    await member.roles.remove(role).catch(() => {});
    
    if (role.members.size === 0) {
      await role.delete().catch(() => {});
    }
  }
  
  return warnRoles.size;
}

// ========== ПОЛУЧЕНИЕ НАСТРОЕК ==========
const getConfig = () => {
  return {
    token: process.env.DISCORD_TOKEN,
    guildId: process.env.GUILD_ID,
    staffRoleId: process.env.STAFF_ROLE_ID,
    logChannelId: process.env.LOG_CHANNEL_ID,
    appealCategoryId: process.env.APPEAL_CATEGORY_ID
  };
};

// ========== ОТПРАВКА ЛОГА ==========
async function sendLog(guild, embed) {
  try {
    const cfg = getConfig();
    if (!cfg.logChannelId) return;
    
    const channel = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
    if (!channel) return;
    
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Ошибка отправки лога:', error);
  }
}

client.once('ready', async () => {
  console.log(`✅ Бот ${client.user.tag} запущен!`);
  
  // Анимация статуса "winter team" ↔ "№1"
  const statuses = ['winter team', '№1'];
  let statusIndex = 0;
  
  setInterval(() => {
    client.user.setActivity(statuses[statusIndex], { type: 3 });
    statusIndex = (statusIndex + 1) % statuses.length;
  }, 5000);
  
  const cfg = getConfig();
  const guild = client.guilds.cache.get(cfg.guildId);
  
  if (guild) {
    await cleanExpiredWarns(guild);
    console.log('✅ Проверка варнов выполнена');
  }
  
  // Периодическая очистка варнов (каждые 10 минут)
  setInterval(async () => {
    const g = client.guilds.cache.get(cfg.guildId);
    if (g) await cleanExpiredWarns(g);
  }, 10 * 60 * 1000);
  
  // Восстановление таймеров событий (если бот перезапустился)
  // (Для простоты не сохраняем события между перезапусками)
  
  // Регистрация команд
  try {
    await client.application.commands.set([
      {
        name: 'warn',
        description: 'Выдать предупреждение пользователю',
        options: [
          { name: 'user', description: 'Пользователь', type: 6, required: true },
          { name: 'days', description: 'Срок в днях', type: 4, required: true },
          { name: 'reason', description: 'Причина', type: 3, required: true },
          { name: 'workoff', description: 'Отработка (необязательно)', type: 3, required: false }
        ]
      },
      {
        name: 'unwarn',
        description: 'Снять все предупреждения с пользователя',
        options: [
          { name: 'user', description: 'Пользователь', type: 6, required: true }
        ]
      },
      { name: 'warnpanel', description: 'Создать панель управления варнами' },
      {
        name: 'send',
        description: 'Отправить сообщение от имени бота в канал (поддерживает # ## ###)',
        options: [
          { name: 'channel', description: 'Канал для отправки', type: 7, required: true },
          { name: 'text', description: 'Текст сообщения (можно # Заголовок)', type: 3, required: false },
          { name: 'name', description: 'Имя отправителя (по умолч. Winter Team)', type: 3, required: false },
          { name: 'avatar', description: 'Ссылка на аватарку', type: 3, required: false }
        ]
      },
      {
        name: 'event',
        description: 'Создать событие с кнопками подтверждения',
        options: [
          { name: 'date', description: 'Дата в формате ДД.ММ.ГГГГ', type: 3, required: true },
          { name: 'time', description: 'Время в формате ЧЧ:ММ (МСК)', type: 3, required: true },
          { name: 'description', description: 'Описание события', type: 3, required: true }
        ]
      }
    ]);
    console.log('✅ Команды зарегистрированы!');
  } catch (error) {
    console.error('❌ Ошибка регистрации:', error);
  }
});

client.on('interactionCreate', async interaction => {
  const cfg = getConfig();
  const hasStaff = interaction.member?.roles?.cache?.has(cfg.staffRoleId) || 
                   interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
  
  // ========== КОМАНДА /warnpanel ==========
  if (interaction.isCommand() && interaction.commandName === 'warnpanel') {
    if (!hasStaff) {
      return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
    }
    
    const embed = new EmbedBuilder()
      .setTitle('⚠️ ПАНЕЛЬ УПРАВЛЕНИЯ ВАРНАМИ')
      .setDescription('**Выберите действие:**')
      .setColor(0xFFA500);
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_warn').setLabel('Выдать варн').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('panel_unwarn').setLabel('Снять варны').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('panel_appeal').setLabel('Обжалование').setEmoji('📝').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panel_workoff').setLabel('Отработка').setEmoji('✅').setStyle(ButtonStyle.Success)
    );
    
    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: '✅ Панель создана!', ephemeral: true });
  }
  
  // ========== КОМАНДА /send ==========
  if (interaction.isCommand() && interaction.commandName === 'send') {
    if (!hasStaff) {
      return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
    }
    
    const channel = interaction.options.getChannel('channel');
    const text = interaction.options.getString('text') || '';
    const customName = interaction.options.getString('name') || 'Winter Team';
    const avatarUrl = interaction.options.getString('avatar') || client.user.displayAvatarURL();
    
    if (!channel.isTextBased()) {
      return interaction.reply({ content: '❌ Канал должен быть текстовым!', ephemeral: true });
    }
    
    const sendData = {
      channelId: channel.id,
      text: text,
      customName: customName,
      avatarUrl: avatarUrl
    };
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`send_photo_${interaction.user.id}`).setLabel('Прикрепить фото').setEmoji('📷').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`send_now_${interaction.user.id}`).setLabel('Отправить сейчас').setEmoji('📤').setStyle(ButtonStyle.Success)
    );
    
    pendingSends.set(interaction.user.id, sendData);
    
    const previewText = text || '(без текста)';
    
    await interaction.reply({
      content: `📤 **Отправка в ${channel}**\nИмя: **${customName}**\n\n**Превью:**\n${previewText}\n\nНажмите кнопку ниже:`,
      components: [row],
      ephemeral: true
    });
  }
  
  // ========== КОМАНДА /event ==========
  if (interaction.isCommand() && interaction.commandName === 'event') {
    const dateStr = interaction.options.getString('date');
    const timeStr = interaction.options.getString('time');
    const description = interaction.options.getString('description');
    
    // Проверка формата даты (ДД.ММ.ГГГГ)
    const dateMatch = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!dateMatch) {
      return interaction.reply({ content: '❌ Неверный формат даты! Используйте ДД.ММ.ГГГГ (например, 25.04.2026)', ephemeral: true });
    }
    
    // Проверка формата времени (ЧЧ:ММ)
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      return interaction.reply({ content: '❌ Неверный формат времени! Используйте ЧЧ:ММ (например, 20:00)', ephemeral: true });
    }
    
    const day = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]);
    const year = parseInt(dateMatch[3]);
    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    
    if (day < 1 || day > 31 || month < 1 || month > 12) {
      return interaction.reply({ content: '❌ Неверная дата!', ephemeral: true });
    }
    
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return interaction.reply({ content: '❌ Неверное время! Часы: 0-23, минуты: 0-59', ephemeral: true });
    }
    
    // Создаём дату события (МСК = UTC+3)
    const eventTime = new Date(Date.UTC(year, month - 1, day, hours - 3, minutes, 0));
    
    const now = new Date();
    if (eventTime < now) {
      return interaction.reply({ content: '❌ Нельзя создать событие в прошлом!', ephemeral: true });
    }
    
    // Время напоминания (за 15 минут)
    const reminderTime = new Date(eventTime.getTime() - 15 * 60 * 1000);
    
    await interaction.deferReply();
    
    // Создаём кнопки
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`event_accept`).setLabel('Приду').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event_decline`).setLabel('Не приду').setEmoji('❌').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`event_maybe`).setLabel('Возможно').setEmoji('❓').setStyle(ButtonStyle.Secondary)
    );
    
    // Создаём Embed
    const embed = new EmbedBuilder()
      .setTitle('📅 СОБЫТИЕ')
      .setDescription(`### ${description}`)
      .addFields(
        { name: '📅 Дата', value: dateStr, inline: true },
        { name: '🕐 Время', value: `${timeStr} МСК`, inline: true },
        { name: '🔔 Напоминание', value: 'За 15 минут', inline: true },
        { name: '✅ Придут (0)', value: '―', inline: true },
        { name: '❌ Не придут (0)', value: '―', inline: true },
        { name: '❓ Возможно (0)', value: '―', inline: true }
      )
      .setColor(0x3498DB)
      .setFooter({ text: `Создал: ${interaction.user.tag}` })
      .setTimestamp();
    
    const message = await interaction.channel.send({ embeds: [embed], components: [row] });
    
    // Сохраняем событие
    const eventId = message.id;
    events.set(eventId, {
      messageId: message.id,
      channelId: interaction.channel.id,
      guildId: interaction.guild.id,
      description: description,
      dateStr: dateStr,
      timeStr: timeStr,
      eventTime: eventTime.getTime(),
      reminderTime: reminderTime.getTime(),
      accept: new Set(),
      decline: new Set(),
      maybe: new Set(),
      embed: embed
    });
    
    // Таймер на напоминание
    const timeUntilReminder = reminderTime.getTime() - Date.now();
    if (timeUntilReminder > 0) {
      setTimeout(async () => {
        const event = events.get(eventId);
        if (!event) return;
        
        const channel = await client.channels.fetch(event.channelId).catch(() => null);
        if (!channel) return;
        
        const usersToPing = [...event.accept, ...event.maybe];
        
        if (usersToPing.length > 0) {
          const mentions = usersToPing.map(id => `<@${id}>`).join(' ');
          await channel.send({
            content: `${mentions}\n🔔 **Напоминание!** Через 15 минут: **${event.description}**`
          });
        } else {
          await channel.send({
            content: `🔔 **Напоминание!** Через 15 минут: **${event.description}**\nПока никто не подтвердил участие.`
          });
        }
        
        // Удаляем событие из хранилища через час после напоминания
        setTimeout(() => events.delete(eventId), 60 * 60 * 1000);
      }, timeUntilReminder);
    }
    
    await interaction.editReply({ content: `✅ Событие создано! ${message.url}`, ephemeral: true });
  }
  
  // ========== КНОПКИ ==========
  if (interaction.isButton()) {
    const id = interaction.customId;
    
    // === КНОПКИ СОБЫТИЙ ===
    if (id === 'event_accept' || id === 'event_decline' || id === 'event_maybe') {
      const messageId = interaction.message.id;
      const event = events.get(messageId);
      
      if (!event) {
        return interaction.reply({ content: '❌ Это событие уже неактивно!', ephemeral: true });
      }
      
      const userId = interaction.user.id;
      
      // Удаляем пользователя из всех списков
      event.accept.delete(userId);
      event.decline.delete(userId);
      event.maybe.delete(userId);
      
      // Добавляем в нужный список
      if (id === 'event_accept') {
        event.accept.add(userId);
      } else if (id === 'event_decline') {
        event.decline.add(userId);
      } else if (id === 'event_maybe') {
        event.maybe.add(userId);
      }
      
      // Формируем списки для отображения
      const acceptList = event.accept.size > 0 
        ? [...event.accept].map(id => `<@${id}>`).join('\n') 
        : '―';
      const declineList = event.decline.size > 0 
        ? [...event.decline].map(id => `<@${id}>`).join('\n') 
        : '―';
      const maybeList = event.maybe.size > 0 
        ? [...event.maybe].map(id => `<@${id}>`).join('\n') 
        : '―';
      
      // Обновляем Embed
      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setFields(
          { name: '📅 Дата', value: event.dateStr, inline: true },
          { name: '🕐 Время', value: `${event.timeStr} МСК`, inline: true },
          { name: '🔔 Напоминание', value: 'За 15 минут', inline: true },
          { name: `✅ Придут (${event.accept.size})`, value: acceptList, inline: true },
          { name: `❌ Не придут (${event.decline.size})`, value: declineList, inline: true },
          { name: `❓ Возможно (${event.maybe.size})`, value: maybeList, inline: true }
        );
      
      await interaction.update({ embeds: [updatedEmbed] });
      
      event.embed = updatedEmbed;
      events.set(messageId, event);
      return;
    }
    
    // === КНОПКИ ВАРНОВ ===
    // Выдать варн
    if (id === 'panel_warn') {
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      const modal = new ModalBuilder().setCustomId('warn_modal').setTitle('⚠️ Выдать предупреждение');
      
      const userInput = new TextInputBuilder().setCustomId('user').setLabel('ID пользователя или @упоминание').setPlaceholder('Например: 1492902233354797329').setStyle(TextInputStyle.Short).setRequired(true);
      const daysInput = new TextInputBuilder().setCustomId('days').setLabel('Срок в днях (любое число)').setPlaceholder('7').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4);
      const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Причина').setPlaceholder('Нарушение правил...').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);
      const workoffInput = new TextInputBuilder().setCustomId('workoff').setLabel('Отработка (необязательно)').setPlaceholder('Например: Принести 1000 серы').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(200);
      
      modal.addComponents(
        new ActionRowBuilder().addComponents(userInput),
        new ActionRowBuilder().addComponents(daysInput),
        new ActionRowBuilder().addComponents(reasonInput),
        new ActionRowBuilder().addComponents(workoffInput)
      );
      
      await interaction.showModal(modal);
    }
    
    // Снять варны
    if (id === 'panel_unwarn') {
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      const modal = new ModalBuilder().setCustomId('unwarn_modal').setTitle('✅ Снять предупреждения');
      const userInput = new TextInputBuilder().setCustomId('user').setLabel('ID пользователя или @упоминание').setPlaceholder('Например: 1492902233354797329').setStyle(TextInputStyle.Short).setRequired(true);
      
      modal.addComponents(new ActionRowBuilder().addComponents(userInput));
      await interaction.showModal(modal);
    }
    
    // Обжалование
    if (id === 'panel_appeal') {
      const warnRoles = interaction.member.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
      
      if (warnRoles.size === 0) {
        return interaction.reply({ content: '❌ У вас нет активных предупреждений!', ephemeral: true });
      }
      
      const modal = new ModalBuilder().setCustomId('appeal_modal').setTitle('📝 Обжалование варна');
      const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Почему варн несправедлив?').setPlaceholder('Опишите вашу ситуацию...').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);
      
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
    }
    
    // Отработка
    if (id === 'panel_workoff') {
      const warnRoles = interaction.member.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
      
      if (warnRoles.size === 0) {
        return interaction.reply({ content: '❌ У вас нет активных предупреждений!', ephemeral: true });
      }
      
      const modal = new ModalBuilder().setCustomId('workoff_modal').setTitle('✅ Отработка варна');
      const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Что вы сделали для отработки?').setPlaceholder('Опишите, что выполнено...').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);
      
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
    }
    
    // Снять варн (в тикете)
    if (id.startsWith('remove_warn_')) {
      const userId = id.split('_')[2];
      
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) return interaction.editReply('❌ Пользователь не найден!');
        
        const removedCount = await removeAllWarns(member);
        
        if (removedCount === 0) {
          return interaction.editReply(`ℹ️ У ${member.user.tag} нет активных предупреждений.`);
        }
        
        const originalEmbed = interaction.message.embeds[0];
        const newEmbed = EmbedBuilder.from(originalEmbed)
          .setColor(0x00FF00)
          .setFooter({ text: `✅ Варны сняты модератором ${interaction.user.tag}` });
        
        await interaction.message.edit({ embeds: [newEmbed], components: [] });
        
        await interaction.editReply({ content: `✅ Снято ${removedCount} варнов с ${member.user.tag}!`, ephemeral: true });
        await interaction.channel.send(`✅ **Варны сняты!** Модератор: <@${interaction.user.id}>`);
        
        const logEmbed = new EmbedBuilder().setTitle('✅ Варны сняты').setColor(0x00FF00).addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '📊 Количество', value: `${removedCount}`, inline: true }
        );
        
        await sendLog(interaction.guild, logEmbed);
        
        try {
          await member.send({ embeds: [new EmbedBuilder().setTitle('✅ Предупреждения сняты').setColor(0x00FF00).setDescription(`**Модератор:** ${interaction.user.tag}\n**Снято варнов:** ${removedCount}`)] });
        } catch (error) {}
        
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply('❌ Произошла ошибка!');
      }
    }
    
    // Закрыть тикет
    if (id.startsWith('close_ticket_')) {
      const channelId = id.replace('close_ticket_', '');
      
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      await interaction.reply({ content: '🔒 Закрываю...', ephemeral: true });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
    }
    
    // === КНОПКИ /send ===
    // Прикрепить фото
    if (id.startsWith('send_photo_')) {
      const userId = id.replace('send_photo_', '');
      if (interaction.user.id !== userId) {
        return interaction.reply({ content: '❌ Это не ваша команда!', ephemeral: true });
      }
      
      const sendData = pendingSends.get(userId);
      if (!sendData) {
        return interaction.reply({ content: '❌ Данные не найдены! Вызовите /send заново.', ephemeral: true });
      }
      
      const modal = new ModalBuilder().setCustomId(`send_modal_${userId}`).setTitle('📷 Прикрепить фото');
      
      const photoInput = new TextInputBuilder().setCustomId('photo_url').setLabel('Ссылка на фото или путь к файлу').setPlaceholder('https://i.imgur.com/... или C:\\photo.png').setStyle(TextInputStyle.Paragraph).setRequired(true);
      
      modal.addComponents(new ActionRowBuilder().addComponents(photoInput));
      
      await interaction.showModal(modal);
    }
    
    // Отправить сейчас
    if (id.startsWith('send_now_')) {
      const userId = id.replace('send_now_', '');
      if (interaction.user.id !== userId) {
        return interaction.reply({ content: '❌ Это не ваша команда!', ephemeral: true });
      }
      
      const sendData = pendingSends.get(userId);
      if (!sendData) {
        return interaction.reply({ content: '❌ Данные не найдены!', ephemeral: true });
      }
      
      await interaction.deferUpdate();
      
      try {
        const channel = await client.channels.fetch(sendData.channelId);
        
        const webhook = await channel.createWebhook({
          name: sendData.customName,
          avatar: sendData.avatarUrl
        });
        
        const embed = new EmbedBuilder()
          .setColor(0x2B2D31)
          .setDescription(sendData.text || '​');
        
        await webhook.send({ embeds: [embed] });
        await webhook.delete();
        
        pendingSends.delete(userId);
        
        await interaction.editReply({
          content: `✅ Сообщение отправлено в ${channel} от имени **${sendData.customName}**!`,
          components: [],
          ephemeral: true
        });
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply({
          content: `❌ Ошибка: ${error.message}`,
          components: [],
          ephemeral: true
        });
      }
    }
  }
  
  // ========== ОБРАБОТКА МОДАЛЬНЫХ ОКОН ==========
  if (interaction.isModalSubmit()) {
    const id = interaction.customId;
    
    // Снятие варнов
    if (id === 'unwarn_modal') {
      const userInput = interaction.fields.getTextInputValue('user');
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        let userId = userInput;
        const mentionMatch = userInput.match(/<@!?(\d+)>/);
        if (mentionMatch) userId = mentionMatch[1];
        
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) return interaction.editReply('❌ Пользователь не найден!');
        
        const removedCount = await removeAllWarns(member);
        
        if (removedCount === 0) {
          return interaction.editReply(`ℹ️ У ${member.user.tag} нет активных предупреждений.`);
        }
        
        const embed = new EmbedBuilder().setTitle('✅ Предупреждения сняты').setColor(0x00FF00).setDescription(`**Пользователь:** <@${member.id}>\n**Модератор:** <@${interaction.user.id}>\n**Снято варнов:** ${removedCount}`);
        
        await interaction.editReply({ embeds: [embed] });
        
        const logEmbed = new EmbedBuilder().setTitle('✅ Варны сняты').setColor(0x00FF00).addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '📊 Количество', value: `${removedCount}`, inline: true }
        );
        
        await sendLog(interaction.guild, logEmbed);
        
        try {
          await member.send({ embeds: [new EmbedBuilder().setTitle('✅ Предупреждения сняты').setColor(0x00FF00).setDescription(`**Модератор:** ${interaction.user.tag}\n**Снято варнов:** ${removedCount}`)] });
        } catch (error) {}
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply('❌ Произошла ошибка!');
      }
    }
    
    // Выдача варна
    if (id === 'warn_modal') {
      const userInput = interaction.fields.getTextInputValue('user');
      const daysInput = interaction.fields.getTextInputValue('days');
      const reason = interaction.fields.getTextInputValue('reason');
      const workoff = interaction.fields.getTextInputValue('workoff') || null;
      
      await interaction.deferReply({ ephemeral: true });
      
      const durationDays = parseInt(daysInput);
      if (isNaN(durationDays) || durationDays <= 0) {
        return interaction.editReply('❌ Срок должен быть положительным числом!');
      }
      
      try {
        let userId = userInput;
        const mentionMatch = userInput.match(/<@!?(\d+)>/);
        if (mentionMatch) userId = mentionMatch[1];
        
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) return interaction.editReply('❌ Пользователь не найден!');
        
        const today = new Date();
        const dateStr = `${today.getDate().toString().padStart(2, '0')}.${(today.getMonth()+1).toString().padStart(2, '0')}.${today.getFullYear()}`;
        
        let roleName = `⚠️ Warn (${dateStr}) [${durationDays}д]`;
        if (reason) roleName += ` | 📝 ${reason}`;
        if (workoff) roleName += ` | 🔄 ${workoff}`;
        
        let warnRole = interaction.guild.roles.cache.find(r => r.name === roleName);
        if (!warnRole) {
          warnRole = await interaction.guild.roles.create({ name: roleName, color: 0xFFA500, reason: `Варн для ${member.user.tag}` });
        }
        
        await member.roles.add(warnRole);
        
        let description = `**Пользователь:** <@${member.id}>\n**Модератор:** <@${interaction.user.id}>\n**Причина:** ${reason}\n**Срок:** ${durationDays} дней\n**Дата выдачи:** ${dateStr}`;
        if (workoff) description += `\n**Отработка:** ${workoff}`;
        
        const embed = new EmbedBuilder().setTitle('⚠️ Предупреждение выдано').setColor(0xFFA500).setDescription(description);
        await interaction.editReply({ embeds: [embed] });
        
        const logEmbed = new EmbedBuilder().setTitle('⚠️ Выдан варн').setColor(0xFFA500).addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '⏰ Срок', value: `${durationDays} дней`, inline: true },
          { name: '📝 Причина', value: reason, inline: false }
        );
        
        if (workoff) logEmbed.addFields({ name: '🔄 Отработка', value: workoff, inline: false });
        
        await sendLog(interaction.guild, logEmbed);
        
        let dmDescription = `**Причина:** ${reason}\n**Модератор:** ${interaction.user.tag}\n**Срок:** ${durationDays} дней`;
        if (workoff) dmDescription += `\n\n**Отработка:** ${workoff}`;
        dmDescription += `\n\nРоль будет автоматически снята через ${durationDays} дней.`;
        
        try {
          await member.send({ embeds: [new EmbedBuilder().setTitle('⚠️ Вы получили предупреждение').setColor(0xFFA500).setDescription(dmDescription)] });
        } catch (error) {}
        
      } catch (error) {
        console.error('❌ Ошибка выдачи варна:', error);
        await interaction.editReply('❌ Произошла ошибка!');
      }
    }
    
    // Обжалование
    if (id === 'appeal_modal') {
      const reason = interaction.fields.getTextInputValue('reason');
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        const user = interaction.user;
        const member = interaction.member;
        const warnRoles = member.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
        
        const warnsList = warnRoles.map(role => {
          const roleName = role.name;
          const reasonMatch = roleName.match(/📝(.+?)(?:\||$)/);
          const workoffMatch = roleName.match(/🔄(.+?)(?:\||$)/);
          
          let displayName = roleName;
          if (reasonMatch) displayName += `\n   └ 📝 **Причина:** ${reasonMatch[1].trim()}`;
          if (workoffMatch) displayName += `\n   └ 🔄 **Отработка:** ${workoffMatch[1].trim()}`;
          return `- ${displayName}`;
        }).join('\n\n');
        
        const channelOptions = {
          name: `📝-обжалование-${user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        };
        
        if (cfg.appealCategoryId) {
          const category = await interaction.guild.channels.fetch(cfg.appealCategoryId).catch(() => null);
          if (category) channelOptions.parent = cfg.appealCategoryId;
        }
        
        if (cfg.staffRoleId) {
          channelOptions.permissionOverwrites.push({ id: cfg.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
        }
        
        const appealChannel = await interaction.guild.channels.create(channelOptions);
        
        const embed = new EmbedBuilder()
          .setTitle('📝 ОБЖАЛОВАНИЕ ВАРНА')
          .setColor(0xFFA500)
          .setDescription(`**Пользователь:** <@${user.id}>\n\n**Активные варны:**\n${warnsList}\n\n**Причина обжалования:**\n> ${reason}`);
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`remove_warn_${user.id}`).setLabel('Снять варны').setEmoji('✅').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`close_ticket_${appealChannel.id}`).setLabel('Закрыть').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
        );
        
        let content = '';
        if (cfg.staffRoleId) content = `<@&${cfg.staffRoleId}>`;
        
        await appealChannel.send({ content, embeds: [embed], components: [row] });
        
        await interaction.editReply({ content: `✅ Обращение создано! Ожидайте в канале ${appealChannel}`, ephemeral: true });
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply({ content: '❌ Произошла ошибка!', ephemeral: true });
      }
    }
    
    // Отработка
    if (id === 'workoff_modal') {
      const reason = interaction.fields.getTextInputValue('reason');
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        const user = interaction.user;
        const member = interaction.member;
        const warnRoles = member.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
        
        const warnsList = warnRoles.map(role => {
          const roleName = role.name;
          const reasonMatch = roleName.match(/📝(.+?)(?:\||$)/);
          const workoffMatch = roleName.match(/🔄(.+?)(?:\||$)/);
          
          let displayName = roleName;
          if (reasonMatch) displayName += `\n   └ 📝 **Причина:** ${reasonMatch[1].trim()}`;
          if (workoffMatch) displayName += `\n   └ 🔄 **Отработка:** ${workoffMatch[1].trim()}`;
          return `- ${displayName}`;
        }).join('\n\n');
        
        const channelOptions = {
          name: `✅-отработка-${user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        };
        
        if (cfg.appealCategoryId) {
          const category = await interaction.guild.channels.fetch(cfg.appealCategoryId).catch(() => null);
          if (category) channelOptions.parent = cfg.appealCategoryId;
        }
        
        if (cfg.staffRoleId) {
          channelOptions.permissionOverwrites.push({ id: cfg.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
        }
        
        const appealChannel = await interaction.guild.channels.create(channelOptions);
        
        const embed = new EmbedBuilder()
          .setTitle('✅ ОТРАБОТКА ВАРНА')
          .setColor(0x00AA00)
          .setDescription(`**Пользователь:** <@${user.id}>\n\n**Активные варны:**\n${warnsList}\n\n**Что сделано:**\n> ${reason}`);
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`remove_warn_${user.id}`).setLabel('Снять варны').setEmoji('✅').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`close_ticket_${appealChannel.id}`).setLabel('Закрыть').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
        );
        
        let content = '';
        if (cfg.staffRoleId) content = `<@&${cfg.staffRoleId}>`;
        
        await appealChannel.send({ content, embeds: [embed], components: [row] });
        
        await interaction.editReply({ content: `✅ Обращение создано! Ожидайте в канале ${appealChannel}`, ephemeral: true });
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply({ content: '❌ Произошла ошибка!', ephemeral: true });
      }
    }
    
    // Модальное окно для фото в /send
    if (id.startsWith('send_modal_')) {
      const userId = id.replace('send_modal_', '');
      const photoUrl = interaction.fields.getTextInputValue('photo_url');
      
      const sendData = pendingSends.get(userId);
      if (!sendData) {
        return interaction.reply({ content: '❌ Данные не найдены!', ephemeral: true });
      }
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        const channel = await client.channels.fetch(sendData.channelId);
        
        const webhook = await channel.createWebhook({
          name: sendData.customName,
          avatar: sendData.avatarUrl
        });
        
        const files = [];
        let fileName = 'image.png';
        
        if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
          const response = await fetch(photoUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          const contentType = response.headers.get('content-type') || '';
          
          if (contentType.includes('png')) fileName = 'image.png';
          else if (contentType.includes('webp')) fileName = 'image.webp';
          else if (contentType.includes('gif')) fileName = 'image.gif';
          
          files.push({ attachment: buffer, name: fileName });
        } else {
          if (fs.existsSync(photoUrl)) {
            fileName = photoUrl.split('/').pop() || photoUrl.split('\\').pop() || 'image.png';
            files.push({ attachment: photoUrl, name: fileName });
          } else {
            await webhook.delete();
            return interaction.editReply('❌ Файл не найден!');
          }
        }
        
        const embed = new EmbedBuilder()
          .setColor(0x2B2D31)
          .setImage(`attachment://${fileName}`)
          .setDescription(sendData.text || null);
        
        await webhook.send({
          embeds: [embed],
          files: files
        });
        
        await webhook.delete();
        
        pendingSends.delete(userId);
        
        await interaction.editReply({
          content: `✅ Сообщение с фото отправлено в ${channel} от имени **${sendData.customName}**!`
        });
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply(`❌ Ошибка: ${error.message}`);
      }
    }
  }
  
  // ========== КОМАНДЫ С ПАРАМЕТРАМИ ==========
  if (interaction.isCommand()) {
    // /warn @user 7 Причина [Отработка]
    if (interaction.commandName === 'warn') {
      if (!hasStaff) return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
      
      const user = interaction.options.getUser('user');
      const days = interaction.options.getInteger('days');
      const reason = interaction.options.getString('reason');
      const workoff = interaction.options.getString('workoff') || null;
      
      if (days <= 0) return interaction.reply({ content: '❌ Срок должен быть положительным числом!', ephemeral: true });
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.editReply('❌ Пользователь не найден!');
        
        const today = new Date();
        const dateStr = `${today.getDate().toString().padStart(2, '0')}.${(today.getMonth()+1).toString().padStart(2, '0')}.${today.getFullYear()}`;
        
        let roleName = `⚠️ Warn (${dateStr}) [${days}д]`;
        if (reason) roleName += ` | 📝 ${reason}`;
        if (workoff) roleName += ` | 🔄 ${workoff}`;
        
        let warnRole = interaction.guild.roles.cache.find(r => r.name === roleName);
        if (!warnRole) {
          warnRole = await interaction.guild.roles.create({ name: roleName, color: 0xFFA500, reason: `Варн для ${member.user.tag}` });
        }
        
        await member.roles.add(warnRole);
        
        let description = `**Пользователь:** <@${member.id}>\n**Модератор:** <@${interaction.user.id}>\n**Причина:** ${reason}\n**Срок:** ${days} дней\n**Дата выдачи:** ${dateStr}`;
        if (workoff) description += `\n**Отработка:** ${workoff}`;
        
        const embed = new EmbedBuilder().setTitle('⚠️ Предупреждение выдано').setColor(0xFFA500).setDescription(description);
        await interaction.editReply({ embeds: [embed] });
        
        const logEmbed = new EmbedBuilder().setTitle('⚠️ Выдан варн').setColor(0xFFA500).addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '⏰ Срок', value: `${days} дней`, inline: true },
          { name: '📝 Причина', value: reason, inline: false }
        );
        
        if (workoff) logEmbed.addFields({ name: '🔄 Отработка', value: workoff, inline: false });
        
        await sendLog(interaction.guild, logEmbed);
        
        let dmDescription = `**Причина:** ${reason}\n**Модератор:** ${interaction.user.tag}\n**Срок:** ${days} дней`;
        if (workoff) dmDescription += `\n\n**Отработка:** ${workoff}`;
        dmDescription += `\n\nРоль будет автоматически снята через ${days} дней.`;
        
        try {
          await member.send({ embeds: [new EmbedBuilder().setTitle('⚠️ Вы получили предупреждение').setColor(0xFFA500).setDescription(dmDescription)] });
        } catch (error) {}
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply('❌ Произошла ошибка!');
      }
    }
    
    // /unwarn @user
    if (interaction.commandName === 'unwarn') {
      if (!hasStaff) return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
      
      const user = interaction.options.getUser('user');
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.editReply('❌ Пользователь не найден!');
        
        const removedCount = await removeAllWarns(member);
        
        if (removedCount === 0) {
          return interaction.editReply(`ℹ️ У ${member.user.tag} нет активных предупреждений.`);
        }
        
        const embed = new EmbedBuilder().setTitle('✅ Предупреждения сняты').setColor(0x00FF00).setDescription(`**Пользователь:** <@${member.id}>\n**Модератор:** <@${interaction.user.id}>\n**Снято варнов:** ${removedCount}`);
        
        await interaction.editReply({ embeds: [embed] });
        
        const logEmbed = new EmbedBuilder().setTitle('✅ Варны сняты').setColor(0x00FF00).addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '📊 Количество', value: `${removedCount}`, inline: true }
        );
        
        await sendLog(interaction.guild, logEmbed);
        
        try {
          await member.send({ embeds: [new EmbedBuilder().setTitle('✅ Предупреждения сняты').setColor(0x00FF00).setDescription(`**Модератор:** ${interaction.user.tag}\n**Снято варнов:** ${removedCount}`)] });
        } catch (error) {}
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply('❌ Произошла ошибка!');
      }
    }
  }
});

// ========== ЗАПУСК ==========
const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('❌ ТОКЕН НЕ НАЙДЕН!'); process.exit(1); }
client.login(token);

// ========== HTTP СЕРВЕР ==========
http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(3000);
